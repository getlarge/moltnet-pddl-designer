import { buildGroundingRequest, groundingTargets } from './source-grounding.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TaskClient } from '@themoltnet/tasks-orchestrator';
import {
  type FakeTaskOutput,
  FakeTasks,
  replayContext,
} from '@themoltnet/tasks-orchestrator/testing';
import { describe, expect, it } from 'vitest';

import type { Domain, Problem } from './ir.js';
import type { DesignInput } from './stages.js';
import {
  blocksActions,
  blocksDomain,
  blocksPredicates,
  blocksProblemResult,
  blocksTypes,
} from './test-fixtures.js';
import {
  type DesignEvent,
  runPddlDesign,
  type StageDecision,
  type StageGate,
} from './workflow.js';

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

const ok = (result: unknown): FakeTaskOutput => ({ summary: 'done', result });

const HAPPY: Record<string, FakeTaskOutput> = {
  types: ok(blocksTypes),
  predicates: ok(blocksPredicates),
  actions: ok({ actions: blocksActions }),
  refine: ok({ actions: blocksActions, changes: [] }),
  problem: ok(blocksProblemResult),
};

const stageOf = (tags: string[] | undefined) =>
  tags?.find((t) => t.startsWith('stage:'))?.slice(6) ?? '';

/** Serve outputs per stage; a list is consumed one attempt at a time. */
function fakeTasks(overrides: Record<string, FakeTaskOutput[]> = {}) {
  return new FakeTasks((body) => {
    const stage = stageOf(body.tags);
    const queue = overrides[stage];
    return queue?.length ? (queue.shift() as FakeTaskOutput) : HAPPY[stage];
  });
}

describe('runPddlDesign', () => {
  it('preserves checked Actions evidence on later-stage resume and drops it for changed context or Actions', async () => {
    const original = await runPddlDesign(fakeTasks(), input);
    const request = buildGroundingRequest(
      input.description,
      blocksDomain,
      [groundingTargets(blocksDomain)[0]],
      input.problemDescription,
    );
    original.sourceChecks = [
      {
        attempt: 1,
        input: request,
        status: 'complete',
        taskId: 'synthetic-check',
        durationMs: 10,
        output: {
          version: 1,
          answers: {
            claim_1: {
              type: 'choice',
              choice: 'supported',
              probabilities: {
                supported: 1,
                contradicted: 0,
                not_established: 0,
              },
              confidence: 1,
            },
          },
        },
      },
    ];
    for (const stage of ['refine', 'problem'] as const) {
      const resumed = await runPddlDesign(fakeTasks(), input, {
        resume: { run: original, stage, feedback: 'Review this stage.' },
      });
      expect(resumed.status).toBe('planned');
      expect(resumed.sourceChecks).toEqual(original.sourceChecks);
      expect(resumed.sourceChecks).not.toBe(original.sourceChecks);
    }
    const changedActions = await runPddlDesign(fakeTasks(), input, {
      resume: {
        run: original,
        stage: 'actions',
        feedback: 'Change the actions.',
      },
    });
    expect(changedActions.sourceChecks).toBeUndefined();
    const changedSituation = await runPddlDesign(
      fakeTasks(),
      { ...input, problemDescription: 'A different situation.' },
      {
        resume: {
          run: original,
          stage: 'problem',
          feedback: 'Use the different situation.',
        },
      },
    );
    expect(changedSituation.sourceChecks).toBeUndefined();
  });

  it('runs five stages, renders PDDL and finds a plan', async () => {
    // Arrange
    const tasks = fakeTasks();

    // Act
    const run = await runPddlDesign(tasks, input);

    // Assert
    expect(run.status).toBe('planned');
    expect(run.stages.map((s) => s.stage)).toEqual([
      'types',
      'predicates',
      'actions',
      'refine',
      'problem',
    ]);
    expect(run.domainPddl).toContain('(define (domain blocks-world)');
    expect(run.problemPddl).toContain(
      '(:goal (and (on-block a b) (on-block b c)))',
    );
    expect(run.plan).toMatchObject({ status: 'found' });
    expect(run.plan?.status === 'found' && run.plan.steps).toHaveLength(4);
    expect(tasks.creationOptions.map((o) => o?.idempotencyKey)).toHaveLength(5);
    expect(
      new Set(tasks.creationOptions.map((o) => o?.idempotencyKey)).size,
    ).toBe(5);
  });

  it('sends a correction task when a stage result fails the checks', async () => {
    // Arrange: first types result references an undefined parent
    const tasks = fakeTasks({
      types: [
        ok({ types: [{ name: 'arm', parent: 'agent', description: 'x' }] }),
      ],
    });

    // Act
    const run = await runPddlDesign(tasks, input);

    // Assert
    const typeAttempts = run.stages.filter((s) => s.stage === 'types');
    expect(typeAttempts.map((s) => s.attempt)).toEqual([1, 2]);
    expect(typeAttempts[0].issues).toEqual([
      {
        severity: 'error',
        path: 'types/arm',
        message: 'parent agent is not defined',
      },
    ]);
    expect(typeAttempts[1].brief).toContain(
      '- [error] types/arm: parent agent is not defined',
    );
    expect(run.status).toBe('planned');
  });

  it('passes draft findings to the refine stage', async () => {
    // Arrange: drop every delete effect so `clear` is never deleted
    const leaky = blocksActions.map((a) => ({ ...a, deleteEffects: [] }));
    const tasks = fakeTasks({ actions: [ok({ actions: leaky })] });

    // Act
    const run = await runPddlDesign(tasks, input);

    // Assert
    const refine = run.stages.find((s) => s.stage === 'refine');
    expect(refine?.brief).toContain(
      '[warning] predicates/clear: no action deletes clear',
    );
  });

  it('keeps unlinked-parameter hints out of the refine brief but in the record', async () => {
    // Arrange: Blocks World draws unlinked hints (any arm may move any block)
    const tasks = fakeTasks();

    // Act
    const run = await runPddlDesign(tasks, input);

    // Assert
    const actions = run.stages.find((s) => s.stage === 'actions');
    const refine = run.stages.find((s) => s.stage === 'refine');
    expect(actions?.issues.some((i) => i.code === 'unlinked-parameters')).toBe(
      true,
    );
    expect(refine?.brief).not.toContain('no precondition links');
    expect(refine?.brief).toContain('Use only the predicates listed below');
  });

  it('sends review findings back to refine for one round', async () => {
    // Arrange: the decision model says the skippable put-down is required
    const tasks = fakeTasks();
    const decisions = {
      yesNo: (state: unknown) =>
        Promise.resolve(
          (state as { step: string }).step === 'put-down' ? 0.95 : 0.1,
        ),
    };

    // Act
    const run = await runPddlDesign(tasks, input, {
      review: { decisions, rounds: 1 },
    });

    // Assert
    const refines = run.stages.filter((s) => s.stage === 'refine');
    expect(refines.map((s) => s.attempt)).toEqual([1, 2]);
    expect(refines[1].brief).toContain('the description requires put-down');
    expect(run.review?.map((r) => r.round)).toEqual([1, 2]);
    expect(run.reviewPassed).toBe(false);
    expect(run.stages.filter((s) => s.stage === 'problem')).toHaveLength(1);
  });

  it('sends badly named results back for correction', async () => {
    // Arrange
    const tasks = fakeTasks({
      types: [ok({ types: [{ name: 'Robot Arm', description: 'x' }] })],
    });

    // Act
    const run = await runPddlDesign(tasks, input);

    // Assert
    const typeAttempts = run.stages.filter((s) => s.stage === 'types');
    expect(typeAttempts.map((s) => s.attempt)).toEqual([1, 2]);
    expect(typeAttempts[1].brief).toContain('"Robot Arm" is not a valid name');
    expect(run.status).toBe('planned');
  });

  it('fails fast when no worker claims a task', async () => {
    // Arrange: every task stays queued
    const tasks: TaskClient = {
      createTask: () => Promise.resolve({ id: 'task-1' } as never),
      getTask: () =>
        Promise.resolve({ id: 'task-1', status: 'queued' } as never),
      listAttempts: () => Promise.resolve([]),
    };

    // Act
    const run = await runPddlDesign(tasks, input, {
      claimTimeoutSec: 0,
      pollIntervalSec: 0,
    });

    // Assert
    expect(run.status).toBe('failed');
    expect(run.failure?.code).toBe('claim-timeout');
    expect(run.failure?.reason).toMatch(
      /no worker claimed task task-1 within 0s; check that a poller is running/,
    );
  });

  it(
    'routes shared work back through predicates and actions',
    { timeout: 120_000 },
    async () => {
      // Arrange: a live-run domain where one issue's work serves the other
      const { domain, problem } = JSON.parse(
        readFileSync(
          resolve(
            dirname(fileURLToPath(import.meta.url)),
            'fixtures',
            'issue-explicit-run.json',
          ),
          'utf8',
        ),
      ) as { domain: Domain; problem: Problem };
      const outputs: Record<string, FakeTaskOutput> = {
        types: ok({ types: domain.types }),
        predicates: ok({ predicates: domain.predicates }),
        actions: ok({ actions: domain.actions }),
        refine: ok({ actions: domain.actions, changes: [] }),
        problem: ok({
          objects: problem.objects,
          init: problem.init,
          goal: problem.goal,
        }),
      };
      const tasks = new FakeTasks((body) => outputs[stageOf(body.tags)]);

      // Act
      const run = await runPddlDesign(tasks, input, { review: { rounds: 1 } });

      // Assert
      expect(run.stages.map((s) => `${s.stage}:${s.attempt}`)).toEqual([
        'types:1',
        'predicates:1',
        'actions:1',
        'refine:1',
        'problem:1',
        'predicates:2',
        'actions:2',
        'refine:2',
      ]);
      const predicates2 = run.stages.find(
        (s) => s.stage === 'predicates' && s.attempt === 2,
      );
      expect(predicates2?.brief).toContain('Add predicates that name the item');
      expect(run.review?.[0].findings.map((f) => f.code)).toContain(
        'shared-work',
      );
      expect(run.reviewPassed).toBe(false);
    },
  );

  it('stops as invalid when corrections do not fix a stage', async () => {
    // Arrange: the problem never declares an arm
    const noArm = ok({
      ...blocksProblemResult,
      objects: blocksProblemResult.objects.filter((o) => o.type === 'block'),
      init: [],
    });
    const tasks = fakeTasks({ problem: [noArm, noArm] });

    // Act
    const run = await runPddlDesign(tasks, input);

    // Assert
    expect(run.status).toBe('invalid');
    expect(run.failure).toEqual({
      stage: 'problem',
      reason: 'still failing checks after 1 correction(s)',
    });
    expect(run.domainPddl).toBeDefined();
    expect(run.plan).toBeUndefined();
  });

  it('reports an unsolvable problem without failing the run', async () => {
    // Arrange: a goal no action can reach
    const tasks = fakeTasks({
      problem: [
        ok({
          ...blocksProblemResult,
          goal: [{ predicate: 'on-block', args: ['a', 'a'], negated: false }],
        }),
      ],
    });

    // Act
    const run = await runPddlDesign(tasks, input);

    // Assert
    expect(run.status).toBe('unsolvable');
    expect(run.grounding?.find((r) => r.action === 'stack')?.instances).toBe(9);
  });

  it('stops as failed when a stage task fails', async () => {
    // Arrange
    const tasks = fakeTasks({ predicates: [{ __taskStatus: 'failed' }] });

    // Act
    const run = await runPddlDesign(tasks, input);

    // Assert
    expect(run.status).toBe('failed');
    expect(run.failure?.stage).toBe('predicates');
    expect(run.stages.map((s) => s.stage)).toEqual(['types']);
  });
});

const badTypes = ok({
  types: [{ name: 'arm', parent: 'agent', description: 'x' }],
});

/** A reviewer answering each gate from a per-stage script, then accepting. */
function reviewer(script: Partial<Record<string, StageDecision[]>> = {}) {
  const gates: StageGate[] = [];
  const confirmStage = async (gate: StageGate): Promise<StageDecision> => {
    gates.push(gate);
    return script[gate.stage]?.shift() ?? { action: 'accept' };
  };
  return { gates, confirmStage };
}

describe('runPddlDesign progress and review gates', () => {
  it('emits task, result and acceptance events per stage, then the plan', async () => {
    // Arrange
    const events: DesignEvent[] = [];

    // Act
    await runPddlDesign(fakeTasks(), input, {
      onEvent: (event) => {
        events.push(event);
      },
    });

    // Assert
    const typesEvents = events
      .filter((e) => 'stage' in e && e.stage === 'types')
      .map((e) => e.type);
    expect(typesEvents).toEqual([
      'task-created',
      'task-claimed',
      'stage-checking',
      'stage-accepted',
    ]);
    expect(
      events
        .filter((e) => e.type === 'stage-result')
        .map((e) => e.type === 'stage-result' && e.record.stage),
    ).toEqual(['types', 'predicates', 'actions', 'refine', 'problem']);
    expect(events.slice(-2).map((e) => e.type)).toEqual([
      'plan-checked',
      'finished',
    ]);
  });

  it('asks the reviewer once per stage and continues on accept', async () => {
    // Arrange
    const { gates, confirmStage } = reviewer();

    // Act
    const run = await runPddlDesign(fakeTasks(), input, { confirmStage });

    // Assert
    expect(gates.map((g) => g.stage)).toEqual([
      'types',
      'predicates',
      'actions',
      'refine',
      'problem',
    ]);
    expect(run.status).toBe('planned');
  });

  it('lets the reviewer fix a stage by editing once corrections are used up', async () => {
    // Arrange: both automatic attempts return an undefined parent type
    const tasks = fakeTasks({ types: [badTypes, badTypes] });
    const { gates, confirmStage } = reviewer({
      types: [{ action: 'edit', result: blocksTypes }],
    });

    // Act
    const run = await runPddlDesign(tasks, input, { confirmStage });

    // Assert
    const types = run.stages.filter((s) => s.stage === 'types');
    expect(types.map((s) => [s.source, s.attempt])).toEqual([
      ['task', 1],
      ['task', 2],
      ['edit', 3],
    ]);
    expect(types[2].taskId).toBeUndefined();
    expect(gates[0].issues.some((i) => i.severity === 'error')).toBe(true);
    expect(run.status).toBe('planned');
  });

  it('shows a schema-rejected edit back to the reviewer with the error', async () => {
    // Arrange
    const rejected = { types: 'not a list' };
    const { gates, confirmStage } = reviewer({
      types: [
        { action: 'edit', result: rejected },
        { action: 'edit', result: blocksTypes },
      ],
    });

    // Act
    const run = await runPddlDesign(fakeTasks(), input, { confirmStage });

    // Assert
    expect(gates[1].result).toBe(rejected);
    expect(gates[1].issues).toMatchObject([
      { severity: 'error', code: 'schema', path: 'types' },
    ]);
    expect(run.status).toBe('planned');
  });

  it('sends reviewer feedback as a new correction task', async () => {
    // Arrange
    const tasks = fakeTasks();
    const { confirmStage } = reviewer({
      types: [{ action: 'feedback', message: 'Add a type for the table.' }],
    });

    // Act
    const run = await runPddlDesign(tasks, input, { confirmStage });

    // Assert
    const types = run.stages.filter((s) => s.stage === 'types');
    expect(types.map((s) => [s.source, s.attempt])).toEqual([
      ['task', 1],
      ['task', 2],
    ]);
    expect(types[1].brief).toContain('Add a type for the table.');
    expect(
      new Set(tasks.creationOptions.map((o) => o?.idempotencyKey)).size,
    ).toBe(tasks.creationOptions.length);
  });

  it('stops as failed with the reason when the reviewer aborts', async () => {
    // Arrange
    const { confirmStage } = reviewer({
      predicates: [{ action: 'abort', reason: 'description is wrong' }],
    });

    // Act
    const run = await runPddlDesign(fakeTasks(), input, { confirmStage });

    // Assert
    expect(run.status).toBe('failed');
    expect(run.failure).toEqual({
      stage: 'predicates',
      reason: 'description is wrong',
    });
  });

  it('refuses to accept a result the checks still reject', async () => {
    // Arrange
    const tasks = fakeTasks({ types: [badTypes, badTypes] });
    const { confirmStage } = reviewer();

    // Act
    const run = await runPddlDesign(tasks, input, { confirmStage });

    // Assert
    expect(run.status).toBe('invalid');
    expect(run.failure?.stage).toBe('types');
  });
});

describe('saved correction runs', () => {
  it('retains checked preceding stages and creates only correction/downstream tasks', async () => {
    const prior = await runPddlDesign(fakeTasks(), input);
    const tasks = fakeTasks();
    const next = await runPddlDesign(
      tasks,
      { ...input, correlationId: 'new-correction' },
      {
        resume: {
          run: prior,
          stage: 'refine',
          feedback: 'Keep separate work for each block.',
        },
      },
    );
    expect(next.status).toBe('planned');
    expect(tasks.creationOptions).toHaveLength(2);
    expect(next.stages.slice(0, 3)).toEqual(prior.stages.slice(0, 3));
    expect(next.stages.find((s) => s.stage === 'refine')?.brief).toContain(
      'Keep separate work for each block.',
    );
  });
  it('requires approval of preceding saved edits before creating correction tasks', async () => {
    const prior = await runPddlDesign(fakeTasks(), input);
    prior.needsReview = ['types', 'predicates', 'actions', 'refine', 'problem'];
    const tasks = fakeTasks();
    await expect(
      runPddlDesign(tasks, input, {
        resume: { run: prior, stage: 'refine', feedback: 'Review this.' },
      }),
    ).rejects.toThrow('Pass the saved types stage');
    expect(tasks.creationOptions).toHaveLength(0);
  });
  it('stops before creating tasks when preceding saved evidence fails checks', async () => {
    const prior = await runPddlDesign(fakeTasks(), input);
    prior.stages[0].result = {
      types: [{ name: 'arm', parent: 'missing', description: 'bad' }],
    };
    const tasks = fakeTasks();
    const run = await runPddlDesign(
      tasks,
      { ...input, correlationId: 'new-correction' },
      { resume: { run: prior, stage: 'refine', feedback: 'Correct this.' } },
    );
    expect(run.status).toBe('invalid');
    expect(tasks.creationOptions).toHaveLength(0);
  });
  it('rejects invented source lines even when the model is otherwise valid', async () => {
    const tasks = fakeTasks({
      types: [
        ok({
          types: [
            { name: 'block', description: 'a block', sourceLines: [999] },
          ],
        }),
      ],
    });
    const run = await runPddlDesign(tasks, input, { maxCorrections: 0 });
    expect(run.status).toBe('invalid');
    expect(run.stages[0].issues.some((i) => i.code === 'source-line')).toBe(
      true,
    );
  });
});

describe('durable polling', () => {
  it.each(['queued', 'running'] as const)(
    'does not repeat historical %s reads on replay',
    async (status) => {
      const fake = fakeTasks();
      let reads = 0;
      let completed = false;
      const tasks: TaskClient = {
        createTask: fake.createTask.bind(fake),
        listAttempts: fake.listAttempts.bind(fake),
        getTask: async (id) => {
          reads++;
          const task = await fake.getTask(id);
          return completed ? task : { ...task, status };
        },
      };
      const ctx = replayContext('poll-recovery');
      const suspended = new Error('durable sleep');
      const elapsed = new Set<string>();
      const names = new Map<string, number>();
      ctx.sleepFor = async (name) => {
        const n = names.get(name) ?? 0;
        names.set(name, n + 1);
        const key = `${name}:${n}`;
        if (!elapsed.has(key)) {
          elapsed.add(key);
          throw suspended;
        }
      };
      for (let replay = 0; replay < 6; replay++) {
        ctx.resetForReplay();
        names.clear();
        const before = reads;
        await expect(runPddlDesign(tasks, input, { ctx })).rejects.toBe(
          suspended,
        );
        expect(reads - before).toBe(
          status === 'running' && replay === 0 ? 2 : 1,
        );
      }
      for (const [name, value] of ctx.checkpointEntries) {
        if (name.includes('.poll'))
          expect(JSON.stringify(value).length).toBeLessThan(120);
      }
      completed = true;
      ctx.resetForReplay();
      names.clear();
      const run = await runPddlDesign(tasks, input, {
        ctx,
        confirmStage: async () => ({ action: 'abort' }),
      });
      expect(run.stages).toHaveLength(1);
      expect(fake.created).toHaveLength(1);
    },
  );
  it('propagates an edit event persistence error instead of inventing a schema finding', async () => {
    const failure = new Error('database unavailable');
    await expect(
      runPddlDesign(fakeTasks(), input, {
        confirmStage: async (gate) => ({ action: 'edit', result: gate.result }),
        onEvent: async (event) => {
          if (event.type === 'stage-checking' && event.attempt === 2)
            throw failure;
        },
      }),
    ).rejects.toBe(failure);
  });
});
