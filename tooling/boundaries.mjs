import { builtinModules } from 'node:module';
import boundaries from 'eslint-plugin-boundaries';
import importX from 'eslint-plugin-import-x';

// These are allowed direct edges, not transitive permissions.
export const dependencyPolicy = {
  domain: [],
  evals: ['domain'],
  contracts: ['domain'],
  persistence: ['domain', 'contracts'],
  workflows: ['domain', 'contracts', 'persistence'],
  web: ['domain', 'contracts'],
  server: ['domain', 'contracts', 'persistence'],
  worker: ['persistence', 'workflows'],
  cli: ['domain', 'contracts', 'workflows'],
};
// The plugin's default import selector does not inspect type-only specifiers.
const inlineTypeImport =
  'ImportDeclaration[importKind!=type][specifiers.length>0]:not(:has(ImportDefaultSpecifier)):not(:has(ImportNamespaceSpecifier)):not(:has(ImportSpecifier[importKind!=type]))';
const applications = new Set(['web', 'server', 'worker', 'cli']);
export const boundaryConfig = {
  files: ['apps/**/*.{js,mjs,cjs,ts,tsx}', 'packages/**/*.{js,mjs,cjs,ts,tsx}'],
  plugins: { boundaries, 'import-x': importX },
  settings: {
    'boundaries/root-path': new URL('..', import.meta.url).pathname,
    'boundaries/elements': Object.keys(dependencyPolicy).map((type) => ({
      type,
      pattern: `${applications.has(type) ? 'apps' : 'packages'}/${type}`,
      mode: 'folder',
    })),
    'boundaries/dependency-nodes': ['export', 'require', 'dynamic-import'],
    'boundaries/additional-dependency-nodes': [
      {
        selector: `ImportDeclaration:not([importKind=type]):not(${inlineTypeImport}) > Literal`,
        kind: 'value',
      },
      {
        selector: 'ImportDeclaration[importKind=type] > Literal',
        kind: 'type',
      },
      { selector: `${inlineTypeImport} > Literal`, kind: 'type' },
      { selector: 'TSImportType > TSLiteralType > Literal', kind: 'type' },
      { selector: 'TSImportType > Literal', kind: 'type' },
    ],
    'import/resolver': {
      typescript: {
        project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
        noWarnOnMultipleProjects: true,
      },
    },
    'import-x/resolver': {
      typescript: {
        project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
        noWarnOnMultipleProjects: true,
      },
    },
  },
  rules: {
    'boundaries/element-types': [
      'error',
      {
        default: 'disallow',
        rules: Object.entries(dependencyPolicy)
          .filter(([, allow]) => allow.length)
          .map(([from, allow]) => ({ from, allow })),
      },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: 'TSImportType[source.value=/^\\./]',
        message:
          'Use a named type import for relative modules so package-entry checks apply.',
      },
      {
        selector: "ImportExpression[source.type!='Literal']",
        message:
          'Use a literal import path so architecture boundaries can be checked.',
      },
    ],
    'boundaries/no-unknown': 'error',
    'boundaries/no-unknown-files': 'error',
    'import-x/no-relative-packages': 'error',
    'import-x/no-unresolved': 'error',
    'import-x/no-extraneous-dependencies': ['error', { includeTypes: true }],
  },
};
export const browserBoundaryConfig = {
  ignores: ['**/*.test.ts'],
  files: [
    'apps/web/src/**/*.{js,mjs,cjs,ts,tsx}',
    'packages/domain/src/**/*.{js,mjs,cjs,ts,tsx}',
    'packages/contracts/src/**/*.{js,mjs,cjs,ts,tsx}',
    'apps/server/src/**/*.{js,mjs,cjs,ts,tsx}',
    'packages/persistence/src/**/*.{js,mjs,cjs,ts,tsx}',
  ],
  rules: {
    'boundaries/external': [
      'error',
      {
        default: 'allow',
        rules: [
          {
            from: ['web', 'domain', 'contracts', 'server', 'persistence'],
            importKind: 'value',
            disallow: ['@themoltnet/tasks-orchestrator'],
          },
          {
            from: ['server', 'persistence'],
            disallow: [
              ['@themoltnet/sdk', { path: '/node' }],
              '@themoltnet/os-keyring',
            ],
          },
          {
            from: ['web', 'domain', 'contracts'],
            disallow: [
              ...new Set(
                builtinModules.flatMap((name) => [name, `node:${name}`]),
              ),
              'node:*',
              ['@themoltnet/sdk', { path: '/node' }],
              '@themoltnet/os-keyring',
              'pg',
              'absurd-sdk',
              'fastify',
            ],
          },
        ],
      },
    ],
  },
};
