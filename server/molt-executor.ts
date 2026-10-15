import { connect } from '@themoltnet/sdk/node';
import { createTeamTaskClient } from '../src/task-client.js';
import { runPddlDesign } from '../src/workflow.js';
import type { Execute, SourceExecute } from './run-service.js';
import { createSourceAssessor } from '../src/source-check.js';

/** Credentials and profile lookup stay in the server/worker process. */
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
    return {
      ...input,
      profileId: profileId(input.profileId),
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
  return runPddlDesign(
    createTeamTaskClient(agent.tasks, input.teamId),
    resolved,
    options,
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
