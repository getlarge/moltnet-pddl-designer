import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApi } from './api.js';
import { RunStore } from './store.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    dev: { type: 'boolean' },
    port: { type: 'string', default: '4317' },
    'runs-dir': { type: 'string', default: 'runs' },
    team: { type: 'string' },
    diary: { type: 'string' },
    profile: { type: 'string' },
  },
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error('Use a port from 0 to 65535.');
const api = createApi({
  root,
  store: new RunStore(resolve(root, values['runs-dir']!)),
  defaults: {
    teamId: values.team ?? process.env.MOLTNET_TEAM_ID,
    diaryId: values.diary ?? process.env.MOLTNET_DIARY_ID,
    profileId: values.profile ?? process.env.MOLTNET_PROFILE_ID,
  },
});
const vite = values.dev
  ? await (
      await import('vite')
    ).createServer({ root, server: { middlewareMode: true }, appType: 'spa' })
  : undefined;
const mime: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};
const server = createServer(async (req, res) => {
  try {
    if (await api(req, res)) return;
    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    const pathname = decodeURIComponent(
      new URL(req.url ?? '/', 'http://localhost').pathname,
    );
    const base = resolve(root, 'dist');
    const path = resolve(
      base,
      `.${pathname === '/' ? '/index.html' : pathname}`,
    );
    if (!path.startsWith(base + '/')) {
      res.writeHead(404);
      res.end();
      return;
    }
    const content = await readFile(path);
    res.writeHead(200, {
      'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('File not found. Run pnpm build before pnpm start.');
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(
    `Galley Proof: http://127.0.0.1:${(server.address() as { port: number }).port}`,
  ),
);
async function close() {
  await vite?.close();
  server.close();
  server.closeAllConnections();
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
