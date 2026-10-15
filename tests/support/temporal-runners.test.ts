import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const detectionCase = (id: string, expected: boolean) => ({
  id,
  split: 'dev',
  family: id,
  phenomenon: 'test',
  origin: 'project-control',
  input: { description: id, action: 'act', vocabulary: [] },
  gold: { hasDurativeEvidence: expected },
  provenance: {
    sourceUrl: 'https://example.org',
    sourceId: id,
    annotation: 'project-curated',
    notes: 'Runner lifecycle test',
  },
});

const extractionCase = (id: string) => ({
  id,
  input: { description: id, action: 'act', vocabulary: [] },
});

let directory: string;
let previousArgv: string[];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'temporal-runner-'));
  previousArgv = process.argv;
  vi.stubEnv('TEAM', 'team');
  vi.stubEnv('DIARY', 'diary');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  process.argv = previousArgv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  for (const moduleName of [
    '@themoltnet/sdk/node',
    '@themoltnet/sdk',
    '@themoltnet/tasks-orchestrator',
    '@pddl/workflows/task-client',
    '@pddl/workflows/decision',
  ])
    vi.doUnmock(moduleName);
  rmSync(directory, { recursive: true, force: true });
});

describe('temporal runner artifacts', () => {
  it('replaces stale detection output before connection and marks partial and complete runs', async () => {
    const casesFile = join(directory, 'detection-cases.json');
    const reportFile = join(directory, 'detection-report.json');
    writeFileSync(
      casesFile,
      JSON.stringify([
        detectionCase('positive', true),
        detectionCase('negative', false),
      ]),
    );
    writeFileSync(
      reportFile,
      JSON.stringify({ status: 'complete', runId: 'old' }),
    );
    process.argv = ['node', 'runner', casesFile, reportFile, 'new-run'];

    const connect = vi.fn().mockRejectedValueOnce(new Error('offline'));
    vi.doMock('@themoltnet/sdk/node', () => ({ connect }));
    await expect(
      import('../../scripts/eval/run-temporal-detection.js'),
    ).rejects.toThrow('offline');
    expect(JSON.parse(readFileSync(reportFile, 'utf8'))).toMatchObject({
      status: 'started',
      runId: 'new-run',
      completed: 0,
    });

    vi.resetModules();
    connect.mockResolvedValue({
      runtimeProfiles: {
        list: async () => ({
          items: [
            {
              id: 'profile',
              name: 'legreffier-pddl-classifier-v1',
              models: { classification: { model: 'fake' } },
            },
          ],
        }),
      },
      tasks: {},
    });
    vi.doMock('@pddl/workflows/task-client', () => ({
      createTeamTaskClient: () => ({}),
    }));
    const yesNo = vi
      .fn()
      .mockResolvedValueOnce(0.9)
      .mockRejectedValueOnce(new Error('second case failed'));
    vi.doMock('@pddl/workflows/decision', () => ({
      createClassifyDecisionClient: () => ({ yesNo }),
    }));
    await expect(
      import('../../scripts/eval/run-temporal-detection.js'),
    ).rejects.toThrow('second case failed');
    expect(JSON.parse(readFileSync(reportFile, 'utf8'))).toMatchObject({
      status: 'partial',
      runId: 'new-run',
      completed: 1,
    });

    vi.resetModules();
    yesNo.mockReset().mockResolvedValueOnce(0.9).mockResolvedValueOnce(0.1);
    await import('../../scripts/eval/run-temporal-detection.js');
    expect(JSON.parse(readFileSync(reportFile, 'utf8'))).toMatchObject({
      status: 'complete',
      runId: 'new-run',
      totals: { cases: 2, correct: 2 },
    });
  });

  it('replaces stale extraction output before connection and records partial and complete runs', async () => {
    const casesFile = join(directory, 'extraction-cases.json');
    const predictionsFile = join(directory, 'predictions.jsonl');
    writeFileSync(
      casesFile,
      JSON.stringify([extractionCase('one'), extractionCase('two')]),
    );
    writeFileSync(predictionsFile, 'old prediction\n');
    writeFileSync(
      `${predictionsFile}.meta.json`,
      JSON.stringify({ runId: 'old', status: 'complete' }),
    );
    process.argv = ['node', 'runner', casesFile, predictionsFile, 'new-run'];

    const connect = vi.fn().mockRejectedValueOnce(new Error('offline'));
    vi.doMock('@themoltnet/sdk/node', () => ({ connect }));
    await expect(import('../../scripts/eval/run-temporal.js')).rejects.toThrow(
      'offline',
    );
    expect(readFileSync(predictionsFile, 'utf8')).toBe('');
    expect(
      JSON.parse(readFileSync(`${predictionsFile}.meta.json`, 'utf8')),
    ).toMatchObject({
      status: 'started',
      runId: 'new-run',
    });

    vi.resetModules();
    connect.mockResolvedValue({
      runtimeProfiles: {
        list: async () => ({
          items: [
            {
              id: 'profile',
              name: 'legreffier-pddl-designer-v1',
              models: { generation: { model: 'fake' } },
            },
          ],
        }),
      },
      tasks: {},
    });
    vi.doMock('@themoltnet/sdk', () => ({
      toOutputContractSchema: (schema: unknown) => schema,
    }));
    const createTask = vi
      .fn()
      .mockResolvedValueOnce({ id: 'task-one' })
      .mockRejectedValueOnce(new Error('second task failed'));
    vi.doMock('@pddl/workflows/task-client', () => ({
      createTeamTaskClient: () => ({
        createTask,
        getTask: async () => ({ status: 'running' }),
      }),
    }));
    vi.doMock('@themoltnet/tasks-orchestrator', () => ({
      createInlineContext: () => ({}),
      waitForTaskOutcome: async () => ({
        kind: 'accepted',
        result: {
          state: {
            hasDurativeEvidence: false,
            durationSeconds: -1,
            conditions: [],
            effects: [],
          },
        },
      }),
    }));
    await expect(import('../../scripts/eval/run-temporal.js')).rejects.toThrow(
      'second task failed',
    );
    expect(
      readFileSync(predictionsFile, 'utf8').trim().split('\n'),
    ).toHaveLength(1);
    expect(
      JSON.parse(readFileSync(`${predictionsFile}.meta.json`, 'utf8')),
    ).toMatchObject({
      status: 'partial',
      runId: 'new-run',
    });

    vi.resetModules();
    createTask
      .mockReset()
      .mockResolvedValueOnce({ id: 'task-one' })
      .mockResolvedValueOnce({ id: 'task-two' });
    await import('../../scripts/eval/run-temporal.js');
    expect(
      readFileSync(predictionsFile, 'utf8').trim().split('\n'),
    ).toHaveLength(2);
    expect(
      JSON.parse(readFileSync(`${predictionsFile}.meta.json`, 'utf8')),
    ).toMatchObject({
      status: 'complete',
      runId: 'new-run',
      timings: [{ id: 'one' }, { id: 'two' }],
    });
  });
});
