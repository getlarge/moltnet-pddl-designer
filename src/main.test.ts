import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { connect } from '@themoltnet/sdk/node';
import { createSdkTaskClient } from '@themoltnet/tasks-orchestrator';
import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from './main.js';
import {
  blocksActions,
  blocksPredicates,
  blocksProblemResult,
  blocksTypes,
} from './test-fixtures.js';

vi.mock('@themoltnet/sdk/node', () => ({ connect: vi.fn() }));
vi.mock('@themoltnet/tasks-orchestrator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@themoltnet/tasks-orchestrator')>()),
  createSdkTaskClient: vi.fn(),
}));

const base = [
  '--description',
  'examples/blocks-world/description.md',
  '--problem',
  'examples/blocks-world/situation.md',
  '--team',
  'team',
  '--diary',
  'diary',
  '--profile',
  'generator',
];
let outputDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  outputDir = mkdtempSync(join(tmpdir(), 'pddl-cli-'));
  vi.mocked(connect).mockResolvedValue({
    runtimeProfiles: {
      list: async () => ({
        items: [
          { name: 'generator', id: 'generation-id' },
          { name: 'classifier', id: 'classification-id' },
        ],
      }),
    },
  } as unknown as Awaited<ReturnType<typeof connect>>);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  rmSync(outputDir, { recursive: true, force: true });
});

describe('warning review CLI', () => {
  it('requires the classification profile before connecting', async () => {
    await expect(main([...base, '--warning-review'])).rejects.toThrow(
      '--classify-profile',
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it.each(['0.5', '0.1', 'NaN'])(
    'rejects warning threshold %s before connecting',
    async (threshold) => {
      await expect(
        main([
          ...base,
          '--warning-review',
          '--classify-profile',
          'classifier',
          '--review-threshold',
          threshold,
        ]),
      ).rejects.toThrow('threshold');
      expect(connect).not.toHaveBeenCalled();
    },
  );

  it('routes standalone early review to the selected profile and serializes its evidence', async () => {
    const outputs: Record<string, unknown> = {
      types: blocksTypes,
      predicates: blocksPredicates,
      actions: { actions: blocksActions },
      refine: { actions: blocksActions, changes: [] },
      problem: blocksProblemResult,
    };
    const tasks = new FakeTasks((body) =>
      body.taskType === 'classify'
        ? {
            version: 1,
            answers: { answer: { type: 'bool', probability: 0.2 } },
          }
        : {
            summary: 'done',
            result:
              outputs[body.tags!.find((t) => t.startsWith('stage:'))!.slice(6)],
          },
    );
    vi.mocked(createSdkTaskClient).mockReturnValue(tasks);
    const output = join(outputDir, 'run.json');

    await main([
      ...base,
      '--warning-review',
      '--classify-profile',
      'classifier',
      '--review-threshold',
      '0.8',
      '--out',
      output,
    ]);

    const run = JSON.parse(readFileSync(output, 'utf8'));
    expect(run.status).toBe('planned');
    expect(run.review).toBeUndefined();
    expect(run.warningReviews[0].threshold).toBe(0.8);
    expect(run.warningReviews[0].decisions[0].verdict).toBe('dismissed');
    const classifications = tasks.created.filter(
      (t) => t.taskType === 'classify',
    );
    expect(classifications).toHaveLength(3);
    expect(
      classifications.every(
        (t) => t.allowedProfiles?.[0].profileId === 'classification-id',
      ),
    ).toBe(true);
  });
});
