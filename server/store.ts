import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
  stat,
} from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readRun } from '../src/saved-run.js';
import type { DesignRun } from '../src/workflow.js';
import type { SavedItem } from './types.js';

export class RunStore {
  constructor(readonly directory: string) {}
  private path(id: string) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
      throw new Error('Invalid run identifier.');
    return join(this.directory, `${id}.json`);
  }
  async get(id: string) {
    return readRun(JSON.parse(await readFile(this.path(id), 'utf8')));
  }
  async save(run: DesignRun) {
    await mkdir(this.directory, { recursive: true });
    const id = randomUUID();
    const target = this.path(id);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, JSON.stringify(run, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporary, target);
    return id;
  }
  async list(): Promise<SavedItem[]> {
    await mkdir(this.directory, { recursive: true });
    const rows: SavedItem[] = [];
    for (const file of await readdir(this.directory)) {
      if (!/^[a-zA-Z0-9_-]{1,100}\.json$/.test(file)) continue;
      const id = file.slice(0, -5);
      try {
        // Listing never runs the planner; opening a file rechecks it.
        const raw = JSON.parse(await readFile(this.path(id), 'utf8'));
        const info = await stat(this.path(id));
        rows.push({
          id,
          name:
            typeof raw.input?.domainName === 'string'
              ? raw.input.domainName
              : id,
          status: String(raw.status ?? 'unknown'),
          updatedAt: info.mtime.toISOString(),
        });
      } catch {
        rows.push({
          id,
          name: id,
          status: 'unreadable',
          updatedAt: '',
          error:
            'This file cannot be read. Import a valid DesignRun JSON file.',
        });
      }
    }
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
