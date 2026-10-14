import { connect } from '@themoltnet/sdk/node';
import { createSdkTaskClient } from '@themoltnet/tasks-orchestrator';
import { runPddlDesign } from '../src/workflow.js';
import type { Execute } from './run-service.js';

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
  return runPddlDesign(createSdkTaskClient(agent), resolved, options);
};
