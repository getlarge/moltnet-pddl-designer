import { connect } from '@themoltnet/sdk/node';
import { createTeamTaskClient } from './task-client.js';
import { runPddlDesign } from './workflow.js';
import type { Execute, SourceExecute } from './executor.js';
import { createSourceAssessor } from './source-check.js';
import { createClassifyDecisionClient } from './decision.js';
import { createTemporalExtractor, runTemporalPass } from './temporal.js';
import { validateTemporalPlan } from './temporal-validate.js';
import type { DecisionClient } from './decision.js';
import type { TemporalExtractor } from './temporal.js';
import type { DesignRun } from '@pddl/contracts/design';
import type { DesignOptions } from './workflow.js';

/** Publish one terminal result after the optional timed rewrite has settled. */
export async function finishTemporalRun(
  run: DesignRun,
  decisions: DecisionClient,
  extractor: TemporalExtractor,
  onEvent?: DesignOptions['onEvent'],
  valBinary?: string,
): Promise<DesignRun> {
  await onEvent?.({ type: 'temporal-started' });
  try {
    const pass = await runTemporalPass(run, decisions, extractor);
    let validationError: string | undefined;
    if (pass.temporalPlan && valBinary) {
      try {
        validateTemporalPlan(pass, valBinary);
      } catch (error) {
        validationError =
          error instanceof Error ? error.message : String(error);
      }
    }
    const { baseRun: _baseRun, ...temporal } = pass;
    run.temporal = {
      ...temporal,
      ...(validationError ? { validationError } : {}),
    };
  } catch (error) {
    run.temporal = {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
  await onEvent?.({ type: 'finished', run });
  return run;
}

/** Credentials and profile lookup stay in the execution process (worker or CLI). */
export const moltExecute: Execute = async (input, options) => {
  const agent = await connect();
  const resolve = async () => {
    const { items } = await agent.runtimeProfiles.list({
      teamId: input.teamId,
    });
    const profileId = (reference: string) => {
      const profile = items.find(
        (p) => p.id === reference || p.name === reference,
      );
      if (!profile)
        throw new Error(
          `Runtime profile "${reference}" was not found in this team.`,
        );
      return profile.id;
    };
    const temporal = input.temporal;
    const classificationProfile = temporal
      ? items.find(
          (p) =>
            p.id === temporal.classificationProfile ||
            p.name === temporal.classificationProfile,
        )
      : undefined;
    if (temporal && !classificationProfile?.models.classification)
      throw new Error(
        'Choose a classification profile in this team and start its classify worker.',
      );
    return {
      ...input,
      profileId: profileId(input.profileId),
      ...(classificationProfile
        ? { temporal: { classificationProfile: classificationProfile.id } }
        : {}),
      stageProfiles: Object.fromEntries(
        Object.entries(input.stageProfiles ?? {}).map(([stage, ref]) => [
          stage,
          profileId(ref),
        ]),
      ),
    };
  };
  const resolved = options.ctx
    ? await options.ctx.step('profiles.resolve', resolve)
    : await resolve();
  const tasks = createTeamTaskClient(agent.tasks, input.teamId);
  const run = await runPddlDesign(tasks, resolved, {
    ...options,
    onEvent: (event) =>
      resolved.temporal && event.type === 'finished'
        ? undefined
        : options.onEvent?.(event),
  });
  if (!resolved.temporal) return run;
  return finishTemporalRun(
    run,
    createClassifyDecisionClient(tasks, {
      teamId: resolved.teamId,
      diaryId: resolved.diaryId,
      ...(resolved.projectId ? { projectId: resolved.projectId } : {}),
      correlationId: resolved.correlationId,
      profileId: resolved.temporal.classificationProfile,
      claimTimeoutSec: options.claimTimeoutSec,
    }),
    createTemporalExtractor(tasks, {
      teamId: resolved.teamId,
      diaryId: resolved.diaryId,
      correlationId: resolved.correlationId,
      profileId: resolved.profileId,
      claimTimeoutSec: options.claimTimeoutSec,
    }),
    options.onEvent,
    process.env.PDDL_VAL_PATH,
  );
};

/** Classification uses the same durable context and team-scoped task transport. */
export const moltAssess: SourceExecute = async (
  input,
  request,
  reference,
  onTask,
  ctx,
) => {
  const agent = await connect();
  const profileId = await ctx.step('source.profile.resolve', async () => {
    const { items } = await agent.runtimeProfiles.list({
      teamId: input.teamId,
    });
    const profile = items.find(
      (p) => p.id === reference || p.name === reference,
    );
    if (!profile?.models.classification)
      throw new Error(
        'Choose a classification profile in this team and start its classify worker.',
      );
    return profile.id;
  });
  return createSourceAssessor(createTeamTaskClient(agent.tasks, input.teamId), {
    teamId: input.teamId,
    diaryId: input.diaryId,
    correlationId: input.correlationId,
    projectId: input.projectId,
    ctx,
  })(request, profileId, onTask);
};
