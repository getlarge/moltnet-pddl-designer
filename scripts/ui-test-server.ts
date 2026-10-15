import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../server/app.js';
import { RunStore } from '../server/store.js';
import { MemoryRuns } from '../server/test-support.js';
const app = await createApp({
  root: resolve('.'),
  dev: true,
  store: new RunStore(await mkdtemp(join(tmpdir(), 'galley-browser-'))),
  runs: new MemoryRuns(),
  defaults: {
    teamId: 'test-team',
    diaryId: 'test-diary',
    profileId: 'test-profile',
  },
});
await app.listen({ port: 4418, host: '127.0.0.1' });
process.once('SIGTERM', () => void app.close());
process.once('SIGINT', () => void app.close());
