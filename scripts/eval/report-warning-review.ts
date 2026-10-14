import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DesignRun } from '../../src/workflow.js';
import type { Issue } from '../../src/check.js';
import type { WarningVerdict } from '../../src/warning-review.js';
import { scoreRun } from '../score-runs.js';

const [dir, prefix] = process.argv.slice(2);
if (!dir || !prefix)
  throw new Error('Usage: report-warning-review RUNS_DIR PREFIX');
const examples = [
  'warning-owned-work',
  'warning-shared-work',
  'warning-inspection',
  'warning-certification',
];
interface ReportRow {
  label: string;
  example: string;
  lane: string;
  status: DesignRun['status'];
  pass: boolean;
  reasons: string[];
  durationMs: number;
  taskCount: number;
  acceptedAttemptInputTokens: number;
  acceptedAttemptOutputTokens: number;
  tasksWithoutUsage: number;
  remainingWarnings: Issue[];
  unresolvedChanges: string[];
  classifications: Array<{
    taskId: string;
    path: string;
    probability: number;
    verdict: WarningVerdict;
    expectedDefect: boolean | null;
    correct: boolean | null;
  }>;
}
const rows: ReportRow[] = [];
for (const file of readdirSync(dir)
  .filter((f) => f.startsWith(`run-${prefix}-`) && f.endsWith('.json'))
  .sort()) {
  const label = file.slice(4, -5);
  const example = examples.find((e) => label.includes(`-${e}-`));
  if (!example) continue;
  const run = JSON.parse(readFileSync(join(dir, file), 'utf8')) as DesignRun;
  const criteria = JSON.parse(
    readFileSync(join(dir, `${prefix}-${example}-required.json`), 'utf8'),
  ) as Parameters<typeof scoreRun>[1] & {
    warningLabels: Array<{
      code: string;
      path: string;
      message?: string;
      defect: boolean;
    }>;
  };
  const score = scoreRun(run, criteria);
  const decisions = run.warningReviews?.flatMap((r) => r.decisions) ?? [];
  const labeled = decisions.map((decision) => {
    const gold = criteria.warningLabels.find(
      (rule) =>
        rule.code === decision.issue.code &&
        new RegExp(rule.path, 'i').test(decision.issue.path) &&
        (!rule.message ||
          new RegExp(rule.message, 'i').test(decision.issue.message)),
    );
    return {
      taskId: decision.taskId,
      path: decision.issue.path,
      probability: decision.probability,
      verdict: decision.verdict,
      expectedDefect: gold?.defect ?? null,
      correct: gold
        ? gold.defect
          ? decision.verdict === 'confirmed'
          : decision.verdict === 'dismissed'
        : null,
    };
  });
  // Raw warnings that survive refinement are useful diagnostics, not proof
  // that a semantic defect survived. Unknown labels remain unscored.
  const usageRecords = [
    ...run.stages.filter((s) => s.source === 'task'),
    ...decisions,
    ...(run.review ?? []).flatMap((r) =>
      Object.values(r.classifications ?? {}),
    ),
  ];
  // Idempotent questions can appear in more than one review round.
  const unique = [...new Map(usageRecords.map((r) => [r.taskId, r])).values()];
  const inputTokens = unique.reduce(
    (n, r) => n + (r.usage?.inputTokens ?? 0),
    0,
  );
  const outputTokens = unique.reduce(
    (n, r) => n + (r.usage?.outputTokens ?? 0),
    0,
  );
  rows.push({
    label,
    example,
    lane: label.slice(prefix.length + 1).split('-')[0],
    status: run.status,
    pass: score.pass,
    reasons: score.reasons,
    durationMs: run.durationMs,
    taskCount: unique.length,
    acceptedAttemptInputTokens: inputTokens,
    acceptedAttemptOutputTokens: outputTokens,
    tasksWithoutUsage: unique.filter((r) => !r.usage).length,
    remainingWarnings: run.issues.filter((i) => i.severity === 'warning'),
    unresolvedChanges:
      run.refinements?.filter((c) =>
        /unresolved|missing predicate|missing fact/i.test(c),
      ) ?? [],
    classifications: labeled,
  });
}
const summary = ['baseline', 'final', 'early'].map((lane) => {
  const trials = rows.filter((r) => r.lane === lane);
  const decisions = trials.flatMap((r) => r.classifications);
  const labeled = decisions.filter((d) => d.expectedDefect !== null);
  return {
    lane,
    runs: trials.length,
    passed: trials.filter((r) => r.pass).length,
    failedOrInvalid: trials.filter(
      (r) => r.status === 'failed' || r.status === 'invalid',
    ).length,
    labeledQuestions: labeled.length,
    correctQuestions: labeled.filter((d) => d.correct).length,
    falsePositives: labeled.filter(
      (d) => !d.expectedDefect && d.verdict === 'confirmed',
    ).length,
    missedDefects: labeled.filter(
      (d) => d.expectedDefect && d.verdict !== 'confirmed',
    ).length,
    uncertainQuestions: decisions.filter((d) => d.verdict === 'uncertain')
      .length,
    unscoredQuestions: decisions.filter((d) => d.expectedDefect === null)
      .length,
    meanDurationMs: trials.length
      ? trials.reduce((n, r) => n + r.durationMs, 0) / trials.length
      : null,
    acceptedAttemptInputTokens: trials.reduce(
      (n, r) => n + r.acceptedAttemptInputTokens,
      0,
    ),
    acceptedAttemptOutputTokens: trials.reduce(
      (n, r) => n + r.acceptedAttemptOutputTokens,
      0,
    ),
  };
});
// A CLI/worker crash can produce a stderr log without a DesignRun.
const missingRuns = readdirSync(dir)
  .filter((f) => f.startsWith(`cli-${prefix}-`) && f.endsWith('.err'))
  .map((f) => f.slice(4, -4))
  .filter((label) => !existsSync(join(dir, `run-${label}.json`)));
const report = {
  note: 'Exploratory comparison. Token counts cover unique accepted attempts only; retries and failed attempts can add usage. Unmatched warning labels are unscored; surviving warnings are not automatically defects. Missing run artifacts are infrastructure failures, not capability failures.',
  summary,
  missingRuns,
  rows,
};
writeFileSync(
  join(dir, `${prefix}-report.json`),
  JSON.stringify(report, null, 2) + '\n',
);
process.stdout.write(JSON.stringify({ summary, missingRuns }, null, 2) + '\n');
