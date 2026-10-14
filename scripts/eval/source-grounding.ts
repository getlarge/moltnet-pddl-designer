/** Small classifier-only pilot. Preview by default; run reads frozen requests, never gold. */
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ClassifyInput } from '@themoltnet/sdk';
import { Value } from 'typebox/value';
import {
  createInlineContext,
  waitForTaskOutcome,
} from '@themoltnet/tasks-orchestrator';
import {
  buildGroundingRequest,
  parseGroundingAnswers,
  type GroundingTarget,
} from '../../src/source-grounding.js';
import type { Domain } from '../../src/ir.js';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'preview' },
    out: { type: 'string' },
    requests: { type: 'string' },
    results: { type: 'string' },
    team: { type: 'string' },
    diary: { type: 'string' },
    profile: { type: 'string' },
    correlation: { type: 'string' },
  },
});
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const load = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const save = async (path: string, value: unknown) => {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  });
  await rename(temporary, path);
};
if (values.mode === 'preview') {
  const fixtures = (await load(
    'examples/source-grounding-pilot/cases.json',
  )) as {
    cases: Array<{
      id: string;
      source: string;
      domain: Domain;
      targets: GroundingTarget[];
    }>;
  };
  const requests = fixtures.cases.map((fixture) => ({
    id: fixture.id,
    input: buildGroundingRequest(
      fixture.source,
      fixture.domain,
      fixture.targets,
    ),
  }));
  const preview = {
    version: 1,
    requestHash: hash(requests),
    taskCount: requests.length,
    generationTasks: 0,
    requests,
  };
  if (values.out) await save(values.out, preview);
  else process.stdout.write(JSON.stringify(preview, null, 2) + '\n');
} else if (values.mode === 'run') {
  if (
    !values.requests ||
    !values.out ||
    !values.team ||
    !values.diary ||
    !values.profile
  )
    throw new Error(
      'Run requires --requests FILE --out FILE --team ID --diary ID --profile NAME|ID.',
    );
  const manifest = (await load(values.requests)) as {
    version: number;
    requestHash: string;
    requests: Array<{ id: string; input: ClassifyInput }>;
  };
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.requests) ||
    manifest.requests.length !== 8 ||
    hash(manifest.requests) !== manifest.requestHash ||
    new Set(manifest.requests.map((r) => r.id)).size !== 8 ||
    manifest.requests.some(
      (r) =>
        !Value.Check(ClassifyInput, r.input) ||
        Object.keys(r.input.questions).length !== 1,
    )
  )
    throw new Error(
      'Run requires an unchanged eight-request preview manifest.',
    );
  // These imports initialize credentials only in explicit run mode.
  const { connect } = await import('@themoltnet/sdk/node');
  const { createSdkTaskClient } =
    await import('@themoltnet/tasks-orchestrator');
  const agent = await connect();
  const profiles = await agent.runtimeProfiles.list({ teamId: values.team });
  const profile = profiles.items.find(
    (p) => p.id === values.profile || p.name === values.profile,
  );
  if (!profile?.models.classification)
    throw new Error('Select an existing classification profile in this team.');
  const tasks = createSdkTaskClient(agent);
  const correlationId = values.correlation ?? randomUUID();
  const report = {
    version: 1,
    requestHash: manifest.requestHash,
    correlationId,
    profile: {
      id: profile.id,
      name: profile.name,
      revision: profile.revision,
      models: profile.models,
    },
    taskCount: 8,
    generationTasks: 0,
    status: 'running',
    results: [] as unknown[],
  };
  await save(values.out, report);
  const ctx = {
    ...createInlineContext(),
    sleepFor: (_name: string, seconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000)),
  };
  for (const request of manifest.requests) {
    const started = Date.now();
    let taskId: string | undefined;
    try {
      const task = await tasks.createTask(
        {
          taskType: 'classify',
          title: 'PDDL source-grounding pilot',
          teamId: values.team,
          diaryId: values.diary,
          correlationId,
          allowedProfiles: [{ profileId: profile.id }],
          tags: ['pddl:designer', 'stage:source-grounding'],
          input: request.input,
          runningTimeoutSec: 120,
          dispatchTimeoutSec: 60,
          expiresInSec: 240,
          maxAttempts: 1,
        },
        {
          idempotencyKey: `pddl-grounding:${correlationId}:${hash(request.input)}`,
        },
      );
      taskId = task.id;
      const deadline = Date.now() + 60000;
      while ((await tasks.getTask(taskId)).status === 'queued') {
        if (Date.now() >= deadline)
          throw new Error('No classifier claimed this task within 60 seconds.');
        await ctx.sleepFor('claim', 1);
      }
      let rawOutput: unknown;
      const outcome = await waitForTaskOutcome(taskId, {
        tasks,
        ctx,
        pollIntervalSec: 1,
        parse: (output) => {
          rawOutput = output;
          return parseGroundingAnswers(output, request.input);
        },
      });
      if (outcome.kind !== 'accepted')
        throw new Error(`Task failed: ${outcome.reason}`);
      report.results.push({
        id: request.id,
        taskId,
        input: request.input,
        rawOutput,
        answers: outcome.result.state,
        usage: outcome.result.attempt.usage,
        durationMs: Date.now() - started,
      });
      await save(values.out, report);
      process.stderr.write(
        `${request.id}: ${JSON.stringify(outcome.result.state)}\n`,
      );
    } catch (error) {
      report.status = 'failed';
      report.results.push({
        id: request.id,
        taskId,
        input: request.input,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      });
      await save(values.out, report);
      throw error; // Abort the remaining cases. No automatic reruns or generation.
    }
  }
  report.status = 'complete';
  await save(values.out, report);
} else if (values.mode === 'report') {
  if (!values.results) throw new Error('Report requires --results FILE.');
  const results = await load(values.results);
  const gold = await load('examples/source-grounding-pilot/gold.json');
  const fixtures = (await load(
    'examples/source-grounding-pilot/cases.json',
  )) as {
    cases: Array<{
      id: string;
      source: string;
      domain: Domain;
      targets: GroundingTarget[];
    }>;
  };
  const frozen = fixtures.cases.map((fixture) => ({
    id: fixture.id,
    input: buildGroundingRequest(
      fixture.source,
      fixture.domain,
      fixture.targets,
    ),
  }));
  if (hash(frozen) !== results.requestHash)
    throw new Error('Results do not match the current pilot requests.');
  const recorded = results.results as Array<{
    id: string;
    input: ClassifyInput;
    rawOutput?: unknown;
    error?: string;
  }>;
  if (
    new Set(recorded.map((r) => r.id)).size !== recorded.length ||
    recorded.some((r) => !gold.cases[r.id])
  )
    throw new Error('Duplicate or unknown result IDs.');
  const rows = frozen.flatMap((request) => {
    const result = recorded.find((r) => r.id === request.id);
    if (result && hash(result.input) !== hash(request.input))
      throw new Error('Recorded request changed.');
    const answers = result?.rawOutput
      ? parseGroundingAnswers(result.rawOutput, request.input)
      : undefined;
    return Object.entries(gold.cases[request.id]).map(
      ([question, expectation]) => {
        const expected = expectation as { relation: string; reason: string };
        const answer = answers?.[question];
        return {
          id: request.id,
          question,
          expected: expected.relation,
          actual: answer?.choice ?? (result?.error ? 'failed' : 'not_run'),
          correct: answer?.choice === expected.relation,
          probabilities: answer?.probabilities,
          confidence: answer?.confidence,
          expectedReason: expected.reason,
          error: result?.error,
        };
      },
    );
  });
  const report = {
    version: 1,
    status: results.status,
    requestHash: results.requestHash,
    expectedCases: Object.keys(gold.cases).length,
    completed: rows.filter(
      (r: { actual: string }) => !['failed', 'not_run'].includes(r.actual),
    ).length,
    correct: rows.filter((r: { correct: boolean }) => r.correct).length,
    trivialBaselines: Object.fromEntries(
      ['supported', 'contradicted', 'not_established'].map((label) => [
        label,
        rows.filter((row) => row.expected === label).length,
      ]),
    ),
    rows,
    limitation:
      'Eight fixed questions, one attempt each. A pilot, not a benchmark or evidence of calibrated thresholds. Expected reasons are human-authored, not model explanations.',
  };
  if (values.out) await save(values.out, report);
  else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else throw new Error('Mode must be preview, run, or report.');
