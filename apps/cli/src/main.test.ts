import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import type { DesignRun } from '@pddl/contracts/design';
import { connect } from '@themoltnet/sdk/node';
import { runPddlDesign } from '@pddl/workflows/workflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './main.js';

vi.mock('@themoltnet/sdk/node', () => ({ connect: vi.fn() }));
vi.mock('@pddl/workflows/workflow', () => ({ runPddlDesign: vi.fn() }));

const directories: string[] = [];
const initialExitCode = process.exitCode;

const baseRun = (): DesignRun => ({
  version: 1,
  status: 'planned',
  input: {
    description: 'Inspecting a ready box takes two minutes.',
    problemDescription: 'Inspect the box.',
    domainName: 'inspection',
    problemName: 'box-case',
    correlationId: 'test-run',
  },
  stages: [],
  issues: [],
  durationMs: 1,
  domain: {
    name: 'inspection',
    types: [{ name: 'box', description: 'A box.' }],
    predicates: [
      {
        name: 'ready',
        parameters: [{ name: '?b', type: 'box' }],
        description: 'Ready.',
      },
      {
        name: 'inspected',
        parameters: [{ name: '?b', type: 'box' }],
        description: 'Inspected.',
      },
    ],
    actions: [
      {
        name: 'inspect',
        parameters: [{ name: '?b', type: 'box' }],
        preconditions: [{ predicate: 'ready', args: ['?b'], negated: false }],
        addEffects: [{ predicate: 'inspected', args: ['?b'] }],
        deleteEffects: [],
        source: 'Inspect the box.',
      },
    ],
  },
  problem: {
    name: 'box-case',
    objects: [{ name: 'box-one', type: 'box' }],
    init: [{ predicate: 'ready', args: ['box-one'] }],
    goal: [{ predicate: 'inspected', args: ['box-one'], negated: false }],
  },
  plan: { status: 'found', steps: ['(inspect box-one)'], explored: 2 },
});

function setup(outputs: ConstructorParameters<typeof FakeTasks>[0]) {
  const dir = mkdtempSync(join(tmpdir(), 'pddl-cli-temporal-'));
  directories.push(dir);
  const description = join(dir, 'description.txt');
  const problem = join(dir, 'situation.txt');
  const out = join(dir, 'run.json');
  writeFileSync(description, 'Inspecting a ready box takes two minutes.');
  writeFileSync(problem, 'Inspect the box.');
  const tasks = new FakeTasks(outputs);
  vi.mocked(connect).mockResolvedValue({
    runtimeProfiles: {
      list: async () => ({
        items: [
          { id: 'freeform-id', name: 'freeform' },
          { id: 'classifier-id', name: 'classifier' },
        ],
      }),
    },
    tasks: {
      create: (
        body: Record<string, unknown>,
        options: { teamId: string; idempotencyKey?: string },
      ) =>
        tasks.createTask({ ...body, teamId: options.teamId } as never, options),
      get: (id: string) => tasks.getTask(id),
      listAttempts: (id: string) => tasks.listAttempts(id),
      listMessages: (id: string, attemptN: number) =>
        tasks.listMessages(id, attemptN),
    },
  } as never);
  vi.mocked(runPddlDesign).mockImplementation(async (_tasks, input) => ({
    ...baseRun(),
    input,
  }));
  return {
    dir,
    out,
    tasks,
    args: [
      '--description',
      description,
      '--problem',
      problem,
      '--team',
      'team',
      '--diary',
      'diary',
      '--profile',
      'freeform',
      '--classify-profile',
      'classifier',
      '--temporal',
      '--out',
      out,
    ],
  };
}

const acceptedOutputs = () => [
  { version: 1, answers: { answer: { type: 'bool', probability: 0.97 } } },
  {
    result: {
      durationSeconds: 120,
      conditions: [
        { predicate: 'ready', args: ['?b'], negated: false, timing: 'start' },
      ],
      effects: [
        { predicate: 'inspected', args: ['?b'], negated: false, timing: 'end' },
      ],
    },
  },
];

beforeEach(() => {
  process.exitCode = undefined;
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = initialExitCode;
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe('temporal CLI', () => {
  it('resolves profiles and saves a VAL-validated timed run', async () => {
    const fixture = setup(acceptedOutputs());
    const binary = join(fixture.dir, 'Validate');
    writeFileSync(binary, '#!/bin/sh\necho "Plan valid"\n');
    chmodSync(binary, 0o755);
    await main([...fixture.args, '--val', binary]);
    const run = JSON.parse(readFileSync(fixture.out, 'utf8')) as DesignRun;
    expect(vi.mocked(runPddlDesign).mock.calls[0][1].profileId).toBe(
      'freeform-id',
    );
    expect(run.input.temporal?.classificationProfile).toBe('classifier-id');
    expect(run.temporal?.status).toBe('complete');
    if (run.temporal?.status === 'complete')
      expect(run.temporal.temporalPlan).toMatchObject({
        status: 'validated',
        validator: 'VAL',
      });
    expect(fixture.tasks.created.map((task) => task.taskType)).toEqual([
      'classify',
      'freeform',
    ]);
    expect(fixture.tasks.created[0].tags).toContain('stage:temporal');
    expect(process.exitCode).toBeUndefined();
  });

  it('saves a rejected VAL candidate and sets a failing exit status', async () => {
    const fixture = setup(acceptedOutputs());
    const binary = join(fixture.dir, 'Validate');
    writeFileSync(binary, '#!/bin/sh\necho "Plan failed"\n');
    chmodSync(binary, 0o755);
    await main([...fixture.args, '--val', binary]);
    const run = JSON.parse(readFileSync(fixture.out, 'utf8')) as DesignRun;
    expect(run.temporal?.status).toBe('complete');
    if (run.temporal?.status === 'complete') {
      expect(run.temporal.temporalPlan?.status).toBe('candidate');
      expect(run.temporal.validationError).toContain('VAL rejected');
    }
    expect(process.exitCode).toBe(1);
  });

  it('retains the classical run when extraction fails and sets a failing exit status', async () => {
    const fixture = setup([
      acceptedOutputs()[0],
      { __taskStatus: 'failed', error: 'worker failed' },
    ]);
    await main(fixture.args);
    const run = JSON.parse(readFileSync(fixture.out, 'utf8')) as DesignRun;
    expect(run.status).toBe('planned');
    expect(run.temporal).toMatchObject({ status: 'failed' });
    expect(process.exitCode).toBe(1);
  });
});
