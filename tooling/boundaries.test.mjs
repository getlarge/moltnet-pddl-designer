import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import { dependencyPolicy } from './boundaries.mjs';
const eslint = new ESLint();
const locations = {
  domain: 'packages/domain/src/probe.ts',
  evals: 'packages/evals/src/probe.ts',
  contracts: 'packages/contracts/src/probe.ts',
  persistence: 'packages/persistence/src/probe.ts',
  workflows: 'packages/workflows/src/probe.ts',
  web: 'apps/web/src/probe.ts',
  server: 'apps/server/src/probe.ts',
  worker: 'apps/worker/src/probe.ts',
  cli: 'apps/cli/src/probe.ts',
};
const modules = {
  domain: '@pddl/domain/ir',
  evals: '@pddl/evals/plan',
  contracts: '@pddl/contracts/design',
  persistence: '@pddl/persistence/store',
  workflows: '@pddl/workflows/workflow',
};
async function errors(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.severity === 2);
}
for (const [from, allowed] of Object.entries(dependencyPolicy)) {
  for (const [to, specifier] of Object.entries(modules)) {
    if (from === to) continue;
    test(`${from} ${allowed.includes(to) ? 'allows' : 'rejects'} ${to}`, async () => {
      const messages = await errors(locations[from], `import '${specifier}';`);
      if (allowed.includes(to)) assert.deepEqual(messages, []);
      else
        assert(
          messages.some((m) => m.ruleId === 'boundaries/element-types'),
          JSON.stringify(messages),
        );
    });
  }
}
const denied = [
  [
    'inline relative escape',
    "export type Domain = import('../../../packages/domain/src/ir.js').Domain;",
    'no-restricted-syntax',
  ],
  [
    'computed dynamic import',
    "const target = '@pddl/workflows/workflow'; void import(target);",
    'no-restricted-syntax',
  ],
  [
    'type import',
    "import type { DesignOptions } from '@pddl/workflows/workflow'; export type Options = DesignOptions;",
    'boundaries/element-types',
  ],
  [
    'inline type import',
    "export type Options = import('@pddl/workflows/workflow').DesignOptions;",
    'boundaries/element-types',
  ],
  [
    're-export',
    "export * from '@pddl/workflows/workflow';",
    'boundaries/element-types',
  ],
  [
    'dynamic import',
    "void import('@pddl/workflows/workflow');",
    'boundaries/element-types',
  ],
  [
    'require',
    "require('@pddl/workflows/workflow');",
    'boundaries/element-types',
  ],
  [
    'relative escape',
    "import '../../../packages/domain/src/ir.js';",
    'import-x/no-relative-packages',
  ],
  [
    'dynamic relative escape',
    "void import('../../../packages/domain/src/ir.js');",
    'import-x/no-relative-packages',
  ],
  [
    'another application',
    "import '../../server/src/app.js';",
    'boundaries/element-types',
  ],
  [
    'private package file',
    "import '@pddl/domain/src/ir';",
    'import-x/no-unresolved',
  ],
  ['node builtin', "void import('node:fs');", 'boundaries/external'],
  [
    'credential adapter',
    "import '@themoltnet/sdk/node';",
    'boundaries/external',
  ],
  ['unknown workspace', "import '@pddl/missing';", 'import-x/no-unresolved'],
];
for (const [name, code, rule] of denied) {
  test(`rejects ${name}`, async () => {
    assert(
      (await errors(locations.web, code)).some((m) => m.ruleId === rule),
      name,
    );
  });
}
test('rejects an unclassified new package', async () => {
  assert(
    (
      await errors(
        'packages/unclassified/src/probe.ts',
        'export const value = 1;',
      )
    ).some((m) => m.ruleId === 'boundaries/no-unknown-files'),
  );
});

for (const from of ['web', 'domain', 'contracts', 'server', 'persistence']) {
  test(`${from} rejects execution SDK code`, async () => {
    assert(
      (
        await errors(
          locations[from],
          "import '@themoltnet/tasks-orchestrator';",
        )
      ).some((m) => m.ruleId === 'boundaries/external'),
    );
  });
}
test('contracts may refer to SDK types without importing execution code', async () => {
  assert.deepEqual(
    await errors(
      locations.contracts,
      "import type { SdkTaskAttempt } from '@themoltnet/tasks-orchestrator'; export type Usage = SdkTaskAttempt['usage'];",
    ),
    [],
  );
});

for (const from of ['web', 'domain', 'contracts']) {
  for (const extension of ['ts', 'tsx', 'js', 'mjs', 'cjs']) {
    test(`${from} enforces external restrictions in ${extension}`, async () => {
      for (const module of [
        'node:fs',
        '@themoltnet/sdk/node',
        '@themoltnet/tasks-orchestrator',
      ]) {
        const code =
          extension === 'cjs' ? `require('${module}');` : `import '${module}';`;
        assert(
          (await errors(locations[from].replace(/ts$/, extension), code)).some(
            (m) => m.ruleId === 'boundaries/external',
          ),
          module,
        );
      }
    });
  }
}
test('contracts accepts inline type-only SDK imports', async () => {
  assert.deepEqual(
    await errors(
      locations.contracts,
      "import { type SdkTaskAttempt } from '@themoltnet/tasks-orchestrator'; export type Attempt = SdkTaskAttempt;",
    ),
    [],
  );
});
test('contracts rejects mixed value and type SDK imports', async () => {
  assert(
    (
      await errors(
        locations.contracts,
        "import { type SdkTaskAttempt, asWorkflowContext } from '@themoltnet/tasks-orchestrator'; export type Attempt = SdkTaskAttempt; export { asWorkflowContext };",
      )
    ).some((m) => m.ruleId === 'boundaries/external'),
  );
});
test('inline type imports still obey workspace directions', async () => {
  assert(
    (
      await errors(
        locations.web,
        "import { type DesignOptions } from '@pddl/workflows/workflow'; export type Options = DesignOptions;",
      )
    ).some((m) => m.ruleId === 'boundaries/element-types'),
  );
});
