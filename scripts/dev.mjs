import { spawn } from 'node:child_process';
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const children = [];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
const entries = args.includes('--offline')
  ? [['apps/server/src/main.ts', '--dev', ...args]]
  : [
      ['apps/worker/src/main.ts'],
      ['apps/server/src/main.ts', '--dev', ...args],
    ];
for (const entry of entries) {
  const child = spawn(process.execPath, ['--import', 'tsx', ...entry], {
    stdio: 'inherit',
  });
  children.push(child);
  child.once('error', (error) => {
    console.error(error);
    close(1);
  });
  child.once('exit', (code) => {
    if (!closing) close(code ?? 1);
  });
}
process.once('SIGINT', () => close());
process.once('SIGTERM', () => close());
