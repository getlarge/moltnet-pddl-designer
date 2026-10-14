import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer as createVite } from 'vite';
import { createApi } from '../server/api.js';
import { RunStore } from '../server/store.js';
import { syntheticExecute } from '../server/test-support.js';
const root = resolve('.');
const api = createApi({
  root,
  store: new RunStore(await mkdtemp(join(tmpdir(), 'galley-browser-'))),
  execute: syntheticExecute,
  defaults: {
    teamId: 'test-team',
    diaryId: 'test-diary',
    profileId: 'test-profile',
  },
});
const vite = await createVite({
  root,
  server: { middlewareMode: true },
  appType: 'spa',
});
createServer((req, res) => {
  void api(req, res).then((handled) => {
    if (!handled) vite.middlewares(req, res);
  });
}).listen(4418, '127.0.0.1');
