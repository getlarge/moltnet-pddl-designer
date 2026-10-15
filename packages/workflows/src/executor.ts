import type { WorkflowContext } from '@themoltnet/tasks-orchestrator';
import type { ClassifyInput } from '@themoltnet/sdk';
import type { DesignInput } from '@pddl/contracts/stages';
import type { DesignRun } from '@pddl/contracts/design';
import type { DesignOptions } from './workflow.js';
import type { SourceAssessor } from './source-check.js';
export type Execute = (
  input: DesignInput,
  options: DesignOptions,
) => Promise<DesignRun>;
export type SourceExecute = (
  input: DesignInput,
  request: ClassifyInput,
  profile: string,
  onTask: (id: string) => void | Promise<void>,
  ctx: WorkflowContext,
) => ReturnType<SourceAssessor>;
