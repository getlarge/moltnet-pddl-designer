import { join } from 'node:path';
import middie from '@fastify/middie';
import staticFiles from '@fastify/static';
import { createApi, type ApiOptions } from './api.js';

export async function createApp(options: ApiOptions & { dev?: boolean }) {
  const app = createApi(options);
  if (options.dev) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: join(options.root, 'apps/web'),
      server: { middlewareMode: true, ws: { server: app.server } },
      appType: 'spa',
    });
    await app.register(middie);
    app.use((req, res, next) => {
      if (req.url?.startsWith('/api/')) return next();
      vite.middlewares(req, res, next);
    });
    app.addHook('onClose', async () => vite.close());
  } else {
    await app.register(staticFiles, {
      root: join(options.root, 'apps/web/dist'),
      wildcard: false,
    });
  }
  return app;
}
