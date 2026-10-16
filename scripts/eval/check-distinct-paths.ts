import { assertDistinctFilePaths } from './distinct-paths.js';

try {
  assertDistinctFilePaths(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 2;
}
