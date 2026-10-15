import { DurableRuns } from '@pddl/persistence/durable-runs';
import { registerWorkflows } from '@pddl/workflows/durable';
import { moltExecute, moltAssess } from '@pddl/workflows/molt-executor';
const databaseUrl = process.env.PDDL_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    'Set PDDL_DATABASE_URL and run pnpm db:init before starting the worker.',
  );
const runs = new DurableRuns({ databaseUrl });
try {
  await runs.initialize();
  registerWorkflows(runs, moltExecute, moltAssess);
  await runs.startWorker();
  console.log('Designer worker ready.');
  const close = () => {
    void runs.close().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} catch (error) {
  await runs.close();
  throw error;
}
