import type { StageName } from './stages.js';

/** Shared vocabulary for generation, review and source-check tasks. */
export const TASK_TAGS = {
  designer: 'pddl:designer',
  stage: {
    types: 'stage:types',
    predicates: 'stage:predicates',
    actions: 'stage:actions',
    refine: 'stage:refine',
    problem: 'stage:problem',
    review: 'stage:review',
    'source-check': 'stage:source-check',
  } satisfies Record<StageName | 'review' | 'source-check', string>,
  domain: (name: string) => `domain:${name}`,
  stageAttempt: (attempt: number) => `stage-attempt:${attempt}`,
} as const;

/** Read the shared values instead of duplicating a prefix and its length. */
export function taskStageFromTags(tags: readonly string[] = []) {
  return (
    Object.keys(TASK_TAGS.stage) as Array<keyof typeof TASK_TAGS.stage>
  ).find((stage) => tags.includes(TASK_TAGS.stage[stage]));
}
