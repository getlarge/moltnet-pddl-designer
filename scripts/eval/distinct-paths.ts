import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export function assertDistinctFilePaths(paths: string[]) {
  const seenPaths = new Map<string, string>();
  const seenFiles = new Map<string, string>();
  for (const path of paths) {
    const absolute = resolve(path);
    let canonical: string;
    try {
      canonical = realpathSync(absolute);
    } catch {
      try {
        canonical = join(realpathSync(dirname(absolute)), basename(absolute));
      } catch {
        canonical = absolute;
      }
    }
    const firstPath = seenPaths.get(canonical);
    if (firstPath)
      throw new Error(`File paths must be distinct: ${firstPath} and ${path}`);
    seenPaths.set(canonical, path);
    try {
      const file = statSync(absolute);
      const identity = `${file.dev}:${file.ino}`;
      const firstFile = seenFiles.get(identity);
      if (firstFile)
        throw new Error(
          `File paths must be distinct: ${firstFile} and ${path}`,
        );
      seenFiles.set(identity, path);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw error;
    }
  }
}
