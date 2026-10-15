# Repository Guidelines

## Agent Worktrees

Before changing tracked files, create a task worktree under `.worktree/` from the repository root: `git fetch origin main` followed by `git worktree add .worktree/<task> -b <branch> origin/main`. Edit, test, and commit inside that worktree; keep the primary checkout clean. If already in a task worktree, continue there. Preserve saved proofs before removing a worktree.

## Project Structure & Module Organization

This is a pnpm TypeScript workspace. `apps/web` contains the React wizard; `apps/server` serves its API; `apps/worker` runs durable jobs; `apps/cli` provides command-line runs. `packages/domain` owns PDDL models, checks, rendering, and planning. `packages/contracts`, `packages/persistence`, and `packages/workflows` hold schemas, storage, and orchestration. Unit tests sit beside source as `*.test.ts`; API, browser, and durable tests live under `tests/`. Process fixtures are in `examples/`, and guides are in `docs/`. Import packages through their `@pddl/*` exports; see `CONTRIBUTING.md` for dependency boundaries.

## Build, Test, and Development Commands

Use Node 24.14.1 or newer and Corepack pnpm:

- `pnpm install` installs workspace dependencies.
- `pnpm db:up` starts local Postgres; set `PDDL_DATABASE_URL` as shown in `README.md`, then run `pnpm db:init`.
- `pnpm dev` starts the local wizard; follow `docs/SETUP.md` for MoltNet worker configuration.
- `pnpm build` builds production packages and the web app.
- `pnpm test`, `pnpm test:browser`, and `pnpm test:durable` run Vitest, Playwright, and recovery suites.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm secretlint` run the CI checks.

## Coding Style & Naming Conventions

Use TypeScript with two-space indentation and Prettier formatting. Keep modules inside their workspace package; use PascalCase for React component files, lower-case names for utilities, and `*.test.ts` for unit tests. ESLint checks React hooks and workspace boundaries; fix warnings rather than suppressing them broadly.

## Testing Guidelines

Add Vitest tests for domain or workflow behavior and Playwright tests for wizard interactions. Cover changed behavior and failure paths; no numeric coverage threshold is configured. Browser tests use synthetic workers without MoltNet credentials. Run the relevant suite before opening a PR.

## Commit & Pull Request Guidelines

Recent commits use prefixes such as `feat:`, `fix:`, `refactor:`, `test:`, and `docs:`. Keep commits focused and write an imperative summary. Open PRs with a concise change description, verification commands and results, linked issues when applicable, and screenshots for visible UI changes. Keep the branch current with `main`; CI and branch protection details are in `CONTRIBUTING.md`. Preserve saved proofs outside a temporary worktree before removing it.
