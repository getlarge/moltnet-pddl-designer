import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApp } from './app.js';
import { RunStore } from '@pddl/persistence/store';
import { DurableRuns } from '@pddl/persistence/durable-runs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { values } = parseArgs({
  options: {
    dev: { type: 'boolean' },
    offline: { type: 'boolean' },
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
const databaseUrl = process.env.PDDL_DATABASE_URL;
if (!values.offline && !databaseUrl)
  throw new Error(
    'Set PDDL_DATABASE_URL and run pnpm db:init for durable runs, or use --offline for saved proofs.',
  );
const runs = values.offline
  ? undefined
  : new DurableRuns({
      databaseUrl: databaseUrl!,
    });
try {
  await runs?.initialize();
  const app = await createApp({
    root,
    dev: values.dev,
    store: new RunStore(resolve(root, values['runs-dir']!)),
    runs,
    defaults: {
      teamId: values.team ?? process.env.MOLTNET_TEAM_ID,
      diaryId: values.diary ?? process.env.MOLTNET_DIARY_ID,
      profileId: values.profile ?? process.env.MOLTNET_PROFILE_ID,
    },
  });
  app.addHook('onClose', async () => runs?.close());
  await app.listen({ port, host: '127.0.0.1' });
  console.log(`Galley Proof: ${app.listeningOrigin}`);
  const close = () => {
    void app.close().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} catch (error) {
  await runs?.close();
  throw error;
}
