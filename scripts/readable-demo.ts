import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createApp } from '../apps/server/src/app.js';
import { RunStore } from '@pddl/persistence/store';
import { MemoryRuns } from '../tests/support/test-support.js';
import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
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
  const runs = new MemoryRuns((input, options) =>
    runPddlDesign(
      new FakeTasks((body) => ({
        summary: 'Local reference draft, not generated output.',
        result: results[taskStageFromTags(body.tags) ?? ''],
      })),
      input,
      options,
    ),
  );
  const app = await createApp({
    root: resolve('.'),
    dev: true,
    runs,
    store: new RunStore(resolve('runs/readable-prototype/proofs')),
  });
  app.addHook('preHandler', async (req, reply) => {
    if (
      req.url.startsWith('/api/') &&
      req.method !== 'GET' &&
      (req.body as { profile?: string } | undefined)?.profile
    )
      return reply.code(409).send({
        error:
          'This preview uses reference drafts. Classification is disabled; no model call will be made.',
      });
  });
  await app.listen({ host: '127.0.0.1', port });
  apps.push(app);
  const input = {
    description,
    problemDescription: situation,
    domainName: domain.name,
    problemName: 'example',
    teamId: 'test-team',
    diaryId: 'test-diary',
    correlationId: crypto.randomUUID(),
    profileId: 'local-reference',
  };
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
