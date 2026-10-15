import { buildTask } from '@themoltnet/sdk';
import { describe, expect, it } from 'vitest';

import { TypesResultSchema } from '@pddl/domain/ir';
import {
  buildActionsTask,
  buildPredicatesTask,
  buildProblemTask,
  buildRefineTask,
  buildTypesTask,
  type DesignInput,
  namingIssues,
  parseActions,
  parseProblem,
  parseTypes,
} from './stages.js';
import {
  blocksActions,
  blocksPredicates,
  blocksProblemResult,
  blocksTypes,
} from '@pddl/domain/test-fixtures';

const input: DesignInput = {
  description: 'Blocks can be stacked by a robotic arm.',
  problemDescription: 'Build a tower a on b on c.',
  domainName: 'blocks-world',
  problemName: 'tower-abc',
  teamId: 'team',
  diaryId: 'diary',
  correlationId: 'corr',
  profileId: 'profile',
};

const bodies = {
  types: buildTypesTask(input),
  predicates: buildPredicatesTask(input, blocksTypes),
  actions: buildActionsTask(input, blocksTypes, blocksPredicates),
  refine: buildRefineTask(
    input,
    blocksTypes,
    blocksPredicates,
    blocksActions,
    [],
  ),
  problem: buildProblemTask(input, '(define (domain blocks-world))', ['block']),
};

describe('stage task bodies', () => {
  it('routes overrides to their own stages and inherits the default elsewhere', () => {
    const routed: DesignInput = {
      ...input,
      stageProfiles: { actions: 'reasoning', refine: 'reviewer' },
    };
    const tasks = [
      buildTypesTask(routed),
      buildPredicatesTask(routed, blocksTypes),
      buildActionsTask(routed, blocksTypes, blocksPredicates),
      buildRefineTask(routed, blocksTypes, blocksPredicates, blocksActions, []),
      buildProblemTask(routed, '(define (domain blocks-world))', ['block']),
    ];
    expect(tasks.map((task) => task.allowedProfiles)).toEqual(
      ['profile', 'profile', 'reasoning', 'reviewer', 'profile'].map(
        (profileId) => [{ profileId }],
      ),
    );
    expect(
      buildActionsTask(routed, blocksTypes, blocksPredicates, 2)
        .allowedProfiles,
    ).toEqual([{ profileId: 'reasoning' }]);
  });

  it.each(Object.entries(bodies))(
    '%s body passes the SDK task validator, output contract included',
    (_stage, body) => {
      // The SDK runs the same create-time validation as the server.
      const building = () =>
        buildTask('freeform', body.input as Record<string, unknown>)
          .team('00000000-0000-4000-8000-000000000001')
          .diary('00000000-0000-4000-8000-000000000002')
          .build();

      expect(building).not.toThrow();
    },
  );

  it('tags each task with its stage and attempt and pins the profile', () => {
    // Act
    const body = buildTypesTask(input, 2);

    // Assert
    expect(body.tags).toEqual([
      'pddl:designer',
      'stage:types',
      'domain:blocks-world',
      'stage-attempt:2',
    ]);
    expect(body.allowedProfiles).toEqual([{ profileId: 'profile' }]);
    expect(body.correlationId).toBe('corr');
  });

  it('fences the process description as untrusted data', () => {
    expect(bodies.types.input.brief).toMatch(
      /<untrusted-process-description nonce="[0-9a-f]{12}">\nBlocks can be stacked by a robotic arm\.\n<\/untrusted-process-description nonce="[0-9a-f]{12}">/,
    );
  });

  it('includes the previous result and its problems in a correction attempt', () => {
    // Act
    const body = buildTypesTask(input, 2, {
      previous: { types: [{ name: 'Robot Arm', description: 'x' }] },
      issues: [{ severity: 'error', path: 'types/0', message: 'bad name' }],
    });

    // Assert
    expect(body.input.brief).toContain('was rejected by deterministic checks');
    expect(body.input.brief).toContain('- [error] types/0: bad name');
  });

  it('asks the problem stage for an object of every action parameter type', () => {
    expect(bodies.problem.input.brief).toContain(
      'Declare at least one object for every type an action takes as a parameter (block)',
    );
  });
});

describe('stage parsers', () => {
  const output = (result: unknown) => ({ summary: 'done', result });

  it('accepts valid results', () => {
    expect(parseTypes(output(blocksTypes))).toEqual(blocksTypes);
    expect(parseActions(output({ actions: blocksActions }))).toEqual({
      actions: blocksActions,
    });
    expect(parseProblem(output(blocksProblemResult))).toEqual(
      blocksProblemResult,
    );
  });

  it('accepts naming violations and reports them for correction', () => {
    // Arrange
    const bad = { types: [{ name: 'Robot Arm', description: 'x' }] };

    // Act
    const parsed = parseTypes(output(bad));
    const issues = namingIssues(TypesResultSchema, parsed);

    // Assert
    expect(parsed).toEqual(bad);
    expect(issues).toEqual([
      {
        severity: 'error',
        path: 'types/0/name',
        message:
          '"Robot Arm" is not a valid name: use lowercase letters, digits and hyphens, starting with a letter; parameters start with ?',
      },
    ]);
  });

  it('still rejects structural errors', () => {
    expect(() => parseTypes(output({ types: 'arm' }))).toThrow(
      /types result \/types/,
    );
  });

  it('rejects a missing result', () => {
    expect(() => parseTypes({ summary: 'done' })).toThrow(/types result/);
  });
});
