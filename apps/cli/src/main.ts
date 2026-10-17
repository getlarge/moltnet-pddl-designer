import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { connect } from '@themoltnet/sdk/node';
import { createTeamTaskClient } from '@pddl/workflows/task-client';

import { createClassifyDecisionClient } from '@pddl/workflows/decision';
import { createTemporalExtractor } from '@pddl/workflows/temporal';
import { finishTemporalRun } from '@pddl/workflows/molt-executor';
import { buildTypesTask, type DesignInput } from '@pddl/workflows/stages';
import { formatEvent } from './progress.js';
import { runPddlDesign } from '@pddl/workflows/workflow';

const USAGE =
  'Usage: pddl-designer --description FILE --problem FILE [--domain-name NAME --problem-name NAME] ' +
  '[--team UUID --diary UUID --profile NAME|ID --correlation UUID --project UUID] [--out FILE] [--max-corrections N] ' +
  '[--types-profile NAME|ID --predicates-profile NAME|ID --actions-profile NAME|ID --refine-profile NAME|ID --problem-profile NAME|ID] ' +
  '[--review --classify-profile NAME|ID [--review-threshold 0.9]] [--temporal --classify-profile NAME|ID [--val PATH]] [--claim-timeout SEC] [--dry-run]';

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      description: { type: 'string' },
      problem: { type: 'string' },
      'domain-name': { type: 'string', default: 'designed-domain' },
      'problem-name': { type: 'string', default: 'designed-problem' },
      team: { type: 'string' },
      diary: { type: 'string' },
      profile: { type: 'string' },
      'types-profile': { type: 'string' },
      'predicates-profile': { type: 'string' },
      'actions-profile': { type: 'string' },
      'refine-profile': { type: 'string' },
      'problem-profile': { type: 'string' },
      project: { type: 'string' },
      correlation: { type: 'string' },
      out: { type: 'string' },
      'max-corrections': { type: 'string', default: '1' },
      review: { type: 'boolean', default: false },
      temporal: { type: 'boolean', default: false },
      val: { type: 'string' },
      'claim-timeout': { type: 'string', default: '600' },
      'classify-profile': { type: 'string' },
      'review-threshold': { type: 'string', default: '0.9' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  if (!values.description || !values.problem) throw new Error(USAGE);
  if (values.val && !values.temporal)
    throw new Error('--val needs --temporal\n' + USAGE);
  const input: DesignInput = {
    description: readFileSync(values.description, 'utf8').trim(),
    problemDescription: readFileSync(values.problem, 'utf8').trim(),
    domainName: values['domain-name'],
    problemName: values['problem-name'],
    teamId: values.team ?? '',
    diaryId: values.diary ?? '',
    correlationId: values.correlation ?? randomUUID(),
    profileId: '',
    ...(values.project ? { projectId: values.project } : {}),
  };
  if (values['dry-run']) {
    process.stdout.write(`${JSON.stringify(buildTypesTask(input), null, 2)}\n`);
    return;
  }
  if (!values.team || !values.diary || !values.profile)
    throw new Error('--team, --diary and --profile are required\n' + USAGE);
  const maxCorrections = Number(values['max-corrections']);
  if (
    !Number.isInteger(maxCorrections) ||
    maxCorrections < 0 ||
    maxCorrections > 3
  )
    throw new Error('--max-corrections must be an integer from 0 to 3');

  const agent = await connect();
  const { items } = await agent.runtimeProfiles.list({ teamId: values.team });
  const profileId = (ref: string) => {
    const found = items.find((item) => item.id === ref || item.name === ref);
    if (!found) throw new Error(`runtime profile ${ref} not found`);
    return found.id;
  };
  input.profileId = profileId(values.profile);
  input.stageProfiles = {};
  for (const stage of [
    'types',
    'predicates',
    'actions',
    'refine',
    'problem',
  ] as const) {
    const reference = values[`${stage}-profile`];
    if (reference) input.stageProfiles[stage] = profileId(reference);
  }
  if ((values.review || values.temporal) && !values['classify-profile'])
    throw new Error(
      '--review and --temporal need --classify-profile\n' + USAGE,
    );
  const classificationProfileId = values['classify-profile']
    ? profileId(values['classify-profile'])
    : undefined;
  if (values.temporal)
    input.temporal = { classificationProfile: classificationProfileId! };

  const threshold = Number(values['review-threshold']);
  if (!(threshold > 0 && threshold < 1))
    throw new Error('--review-threshold must be between 0 and 1');
  const claimTimeoutSec = Number(values['claim-timeout']);
  if (!Number.isInteger(claimTimeoutSec) || claimTimeoutSec < 0)
    throw new Error('--claim-timeout must be a non-negative integer (seconds)');
  const tasks = createTeamTaskClient(agent.tasks, input.teamId);
  const run = await runPddlDesign(tasks, input, {
    maxCorrections,
    claimTimeoutSec,
    onEvent: (event) => {
      const line = formatEvent(event);
      if (line) process.stderr.write(`[pddl-designer] ${line}\n`);
    },
    ...(values.review
      ? {
          review: {
            threshold,
            decisions: createClassifyDecisionClient(tasks, {
              teamId: input.teamId,
              diaryId: input.diaryId,
              ...(input.projectId ? { projectId: input.projectId } : {}),
              correlationId: input.correlationId,
              profileId: classificationProfileId!,
              claimTimeoutSec,
            }),
          },
        }
      : {}),
  });
  if (values.temporal) {
    try {
      await finishTemporalRun(
        run,
        createClassifyDecisionClient(tasks, {
          teamId: input.teamId,
          diaryId: input.diaryId,
          ...(input.projectId ? { projectId: input.projectId } : {}),
          correlationId: input.correlationId,
          profileId: classificationProfileId!,
          claimTimeoutSec,
          purpose: 'temporal',
        }),
        createTemporalExtractor(tasks, {
          teamId: input.teamId,
          diaryId: input.diaryId,
          projectId: input.projectId,
          correlationId: input.correlationId,
          profileId: input.profileId,
          claimTimeoutSec,
        }),
        undefined,
        values.val,
      );
    } catch (error) {
      run.temporal = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
      if (values.out)
        writeFileSync(values.out, `${JSON.stringify(run, null, 2)}\n`);
      throw error;
    }
  }
  const text = `${JSON.stringify(run, null, 2)}\n`;
  if (values.out) writeFileSync(values.out, text);
  else process.stdout.write(text);
  process.stderr.write(
    `[pddl-designer] status=${run.status} stages=${run.stages.length}` +
      (values.temporal
        ? ` temporal=${run.temporal?.status === 'complete' ? run.temporal.durativeActions.length : 0} temporal-plan=${run.temporal?.status === 'complete' ? (run.temporal.temporalPlan?.status ?? 'none') : 'none'}`
        : '') +
      (run.plan?.status === 'found'
        ? ` plan=${run.plan.steps.length} steps`
        : '') +
      (run.reviewPassed === undefined
        ? ''
        : ` review=${run.reviewPassed ? 'passed' : 'findings'} rounds=${run.review?.length ?? 0}`) +
      (run.failure
        ? ` failure=${run.failure.stage}: ${run.failure.reason}`
        : '') +
      '\n',
  );
  if (
    run.status === 'failed' ||
    run.status === 'invalid' ||
    run.temporal?.status === 'failed' ||
    (values.val &&
      run.temporal?.status === 'complete' &&
      run.temporal.validationError)
  )
    process.exitCode = 1;
}
