import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
const waitFor = async (check: () => boolean) => {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Stub runner did not start');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

afterEach(() => {
  for (const directory of directories)
    rmSync(directory, { recursive: true, force: true });
  directories.length = 0;
});

describe('temporal shell interruption', () => {
  it.each([
    ['run-temporal.sh', 'evals/temporal/v1.json'],
    ['run-temporal-detection.sh', 'evals/temporal/detection-v2.json'],
  ])(
    '%s stops its runner and poller and marks the report failed',
    async (name, cases) => {
      const directory = mkdtempSync(join(tmpdir(), 'temporal-signal-'));
      directories.push(directory);
      const fakeNode = join(directory, 'node');
      const fakePoller = join(directory, 'moltnet-agent');
      writeFileSync(
        fakeNode,
        '#!/bin/sh\nif [ "$1" = "--import" ] && [ "$3" != "scripts/eval/check-distinct-paths.ts" ]; then echo $$ > "$TEMPORAL_RUNNER_PID"; exec sleep 30; fi\nexec "$TEMPORAL_REAL_NODE" "$@"\n',
        { mode: 0o755 },
      );
      writeFileSync(
        fakePoller,
        '#!/bin/sh\necho $$ > "$TEMPORAL_POLLER_PID"\nexec sleep 30\n',
        { mode: 0o755 },
      );
      const runnerPid = join(directory, 'runner.pid');
      const pollerPid = join(directory, 'poller.pid');
      const report = join(directory, 'report.json');
      const args =
        name === 'run-temporal.sh'
          ? [cases, join(directory, 'predictions.jsonl'), report]
          : [cases, report];
      const child = spawn(
        'sh',
        [join(process.cwd(), 'scripts/eval', name), ...args],
        {
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            TEAM: 'test',
            DIARY: 'test',
            TEMPORAL_REAL_NODE: process.execPath,
            TEMPORAL_RUNNER_PID: runnerPid,
            TEMPORAL_POLLER_PID: pollerPid,
          },
          stdio: 'ignore',
        },
      );
      try {
        await waitFor(() => {
          try {
            return Boolean(
              readFileSync(runnerPid, 'utf8') &&
              readFileSync(pollerPid, 'utf8'),
            );
          } catch {
            return false;
          }
        });
        const exited = new Promise<number | null>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Wrapper did not exit')),
            5_000,
          );
          child.once('exit', (code) => {
            clearTimeout(timeout);
            resolve(code);
          });
        });
        child.kill('SIGTERM');
        const exitCode = await exited;
        expect(exitCode).toBe(143);
        expect(JSON.parse(readFileSync(report, 'utf8'))).toMatchObject({
          status: 'failed',
          error: 'Interrupted by SIGTERM.',
        });
        if (name === 'run-temporal.sh')
          expect(
            JSON.parse(readFileSync(`${args[1]}.meta.json`, 'utf8')),
          ).toMatchObject({
            status: 'failed',
            error: 'Interrupted by SIGTERM.',
          });
        for (const file of [runnerPid, pollerPid]) {
          const pid = Number(readFileSync(file, 'utf8'));
          expect(() => process.kill(pid, 0)).toThrow();
        }
      } finally {
        if (child.exitCode === null && child.signalCode === null)
          child.kill('SIGKILL');
      }
    },
    10_000,
  );
});
