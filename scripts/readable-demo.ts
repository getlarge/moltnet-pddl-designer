import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createApp } from '../apps/server/src/app.js';
import { RunStore } from '@pddl/persistence/store';
import { MemoryRuns } from '../tests/support/test-support.js';
import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import { createInlineContext } from '@themoltnet/tasks-orchestrator';
import { moltAssess } from '@pddl/workflows/molt-executor';
import { runPddlDesign } from '@pddl/workflows/workflow';
import { taskStageFromTags } from '@pddl/workflows/task-tags';
import { blocksProblemResult } from '@pddl/domain/test-fixtures';
import {
  readableBlocksDomain as blocks,
  parcelInspectionDomain as parcels,
} from '../tests/support/readable-fixtures.js';
const apps: Awaited<ReturnType<typeof createApp>>[] = [];
const demos = [];
await mkdir('runs/readable-prototype', { recursive: true });
for (const [domain, port, description, situation] of [
  [
    blocks,
    4430,
    await readFile('examples/blocks-world/description.md', 'utf8'),
    await readFile('examples/blocks-world/situation.md', 'utf8'),
  ],
  [
    parcels,
    4431,
    'A worker inspects a parcel, creating a fresh inspection and a historical inspection record. Processing a parcel requires a fresh inspection and its inspection record. Processing uses up the fresh inspection: it cannot be reused for another processing. The historical inspection record remains available afterward.',
    'Parcel P has not yet been inspected. Worker W must process parcel P.',
  ],
] as const) {
  const input = {
    description,
    problemDescription: situation,
    domainName: domain.name,
    problemName: 'example',
    teamId:
      process.env.MOLTNET_TEAM_ID ?? '6743b4b1-6b93-46e2-a048-19490f04f91a',
    diaryId:
      process.env.MOLTNET_DIARY_ID ?? '8a4d7ecd-b7ec-49d1-8e50-0da328159ed0',
    correlationId: crypto.randomUUID(),
    generationProfileId: 'local-reference',
  };
  const results: Record<string, unknown> = {
    types: { types: domain.types },
    predicates: { predicates: domain.predicates },
    actions: { actions: domain.actions },
    refine: { actions: domain.actions, changes: [] },
    problem:
      domain.name === 'parcel-inspection'
        ? {
            objects: [
              { name: 'parcel-p', type: 'parcel' },
              { name: 'worker-w', type: 'worker' },
            ],
            init: [],
            goal: [
              { predicate: 'processed', args: ['parcel-p'], negated: false },
            ],
          }
        : blocksProblemResult,
  };
  const runs = new MemoryRuns(
    (input, options) =>
      runPddlDesign(
        new FakeTasks((body) => ({
          summary: 'Local reference draft, not generated output.',
          result: results[taskStageFromTags(body.tags) ?? ''],
        })),
        input,
        options,
      ),
    (request, profile, onTask) =>
      moltAssess(input, request, profile, onTask, {
        ...createInlineContext(),
        sleepFor: (_name, seconds) =>
          new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000)),
      }),
  );
  const app = await createApp({
    root: resolve('.'),
    dev: true,
    runs,
    store: new RunStore(resolve('runs/readable-prototype/proofs')),
  });
  await app.listen({ host: '127.0.0.1', port });
  apps.push(app);
  const first = await runs.start(input, {});
  let s = await runs.get(first.id);
  while (s?.gate?.stage !== 'actions') {
    if (s?.gate) await runs.decide(first.id, s.gate.id, { action: 'accept' });
    await new Promise((r) => setTimeout(r, 50));
    s = await runs.get(first.id);
    if (s?.state === 'failed' || s?.state === 'finished')
      throw new Error(JSON.stringify(s));
  }
  demos.push({
    name: domain.name,
    port,
    runId: first.id,
    url: `http://127.0.0.1:${port}/#run/${first.id}`,
    gateId: s.gate.id,
    correlationId: input.correlationId,
  });
  console.log(
    `PROTOTYPE ${domain.name} http://127.0.0.1:${port}/#run/${first.id}`,
  );
}
await writeFile(
  'runs/readable-prototype/demos.json',
  JSON.stringify(demos, null, 2),
);
process.once('SIGTERM', () => {
  void Promise.all(apps.map((app) => app.close())).then(() => process.exit(0));
});
