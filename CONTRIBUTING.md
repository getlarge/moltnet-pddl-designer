# Contributing

## Development

Use the Node version in `.tool-versions` (Node 24.14.1 or newer) and enable
pnpm through Corepack:

```bash
corepack enable
pnpm install
pnpm test
pnpm typecheck
```

`pnpm-workspace.yaml` exempts `@themoltnet/*` from pnpm's release-age gate, so
a freshly published SDK installs immediately; every other dependency still
waits out the gate.

## Continuous integration and branch protection

Ready pull requests and pushes to `main` run ESLint, Secretlint, formatting
checks, TypeScript checks, unit/API tests, the production build, and browser
tests using the Node version pinned in `.tool-versions`.
Draft PRs skip CI until marked ready. Browser tests use Playwright Chromium in
CI and installed Chrome locally; synthetic workers require no MoltNet secrets.
Failures upload traces, screenshots, and browser reports for seven days.

The checked-in `Protect main` ruleset defines a pull request with one approval,
resolved review conversations, and the GitHub Actions `CI passed` check against an
up-to-date branch. New commits dismiss stale approvals. Force-pushes and branch
deletion are blocked, with no bypass actors. Its configuration is tracked in
[.github/rulesets/main.json](.github/rulesets/main.json). Also enable automatic
deletion of merged PR branches in repository settings. Editing the JSON alone
does not change the live ruleset. A repository administrator can create it from
a checkout containing this file:

```bash
gh api --method POST repos/getlarge/moltnet-pddl-designer/rulesets \
  --input .github/rulesets/main.json
gh repo edit getlarge/moltnet-pddl-designer --delete-branch-on-merge
```

Run the creation command once; use the existing ruleset ID to update it later.
Repository administration settings are applied separately from code changes.

## Worktrees and saved proofs

Before removing a development worktree, preserve ignored local proofs and
exports. Use `--runs-dir` with a persistent directory outside the worktree to
keep saved proofs independent of branch cleanup.

## Local lint checks

```bash
pnpm lint
pnpm secretlint
pnpm format:check
```

ESLint checks JavaScript and TypeScript with recommended rules, plus React hook
rules in the UI. Warnings fail the check. Secretlint uses its recommended preset
and scans text files, including dotfiles and workflow configuration. It uses the
repository's explicit `.secretlintignore` instead of inherited Git ignore rules;
dependencies, generated output, screenshots, and local runtime state are excluded.
For a deliberate fake credential in a fixture, use a rule-scoped
`secretlint-disable-next-line` comment with an explanation; do not disable the
scanner for the whole test directory. Use Node 24.14.1 or newer, matching the
minimum version in `package.json`.

## Repository layout and boundaries

This is a pnpm workspace. Run commands from the repository root; each
package declares its own dependencies and exports TypeScript source. There are
no TypeScript path aliases or prerequisite library builds.

| Location               | Responsibility                                                | Allowed workspace dependencies |
| ---------------------- | ------------------------------------------------------------- | ------------------------------ |
| `apps/web`             | React interface and Vite build                                | domain, contracts              |
| `apps/server`          | Fastify HTTP/SSE and web asset serving                        | domain, contracts, persistence |
| `apps/worker`          | Durable worker process and credentials                        | persistence, workflows         |
| `apps/cli`             | Inline command-line execution                                 | domain, contracts, workflows   |
| `packages/domain`      | PDDL IR, validation, planning, rendering and provenance       | none                           |
| `packages/contracts`   | Shared run/API types, schemas and saved-proof validation      | domain                         |
| `packages/persistence` | Postgres/Absurd storage, gates, migrations, saved files       | domain, contracts              |
| `packages/workflows`   | Task builders, orchestration, reviews and worker registration | domain, contracts, persistence |

Import other packages through explicit exports such as `@pddl/domain/planner`.
Applications never import each other; packages never import applications.
`pnpm lint` enforces the table, declared dependencies, browser-safe imports,
and package entry points. Type-only imports, re-exports, dynamic imports and
`require` are checked too. Relative imports must stay within their package;
use named type imports instead of relative inline `import()` types. Dynamic
imports must use literal paths. A new package must be classified explicitly in
`tooling/boundaries.mjs`.

`pnpm test:boundaries` tests allowed and forbidden imports against the real ESLint
configuration. CI runs it through `pnpm lint`. Node-based unit tests may read
fixture files; this does not relax their workspace dependency rules.
Cross-app integration fixtures live in `tests/support`; browser and recovery
suites live in `tests/browser` and `tests/durable`. Root `scripts` are developer
tools and may compose applications for tests. Production packages cannot import
these harnesses. Database migrations live with persistence and `pnpm db:init`
remains their entry point.
