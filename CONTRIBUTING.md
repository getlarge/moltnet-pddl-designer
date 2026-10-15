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

The proposed `Protect main` ruleset requires a pull request with one approval,
resolved review conversations, and the GitHub Actions `CI passed` check against an
up-to-date branch. New commits dismiss stale approvals. Force-pushes and branch
deletion are blocked, with no bypass actors. This ruleset is intended to replace
legacy branch protection; its configuration is tracked in
[.github/rulesets/main.json](.github/rulesets/main.json). Also enable automatic
deletion of merged PR branches in repository settings. Editing the JSON alone
does not change the live ruleset. Once CI is available, a repository
administrator can create it from a checkout containing this file:

```bash
gh api --method POST repos/getlarge/moltnet-pddl-designer/rulesets \
  --input .github/rulesets/main.json
gh repo edit getlarge/moltnet-pddl-designer --delete-branch-on-merge
```

Run the creation command once; use the existing ruleset ID to update it later.
The CI setup PR does not activate repository administration settings.

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
scanner for the whole test directory.
