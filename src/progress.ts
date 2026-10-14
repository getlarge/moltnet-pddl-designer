import { hasErrors } from './check.js';
import type { DesignEvent } from './workflow.js';

/** One progress line per event, or undefined for events not worth a line. */
export function formatEvent(event: DesignEvent): string | undefined {
  switch (event.type) {
    case 'task-created':
      return `${event.stage} #${event.attempt}: task ${event.taskId} created`;
    case 'task-claimed':
      return `${event.stage} #${event.attempt}: claimed`;
    case 'stage-checking':
      return `${event.stage} #${event.attempt}: checking`;
    case 'stage-result': {
      const { record } = event;
      const errors = record.issues.filter((i) => i.severity === 'error').length;
      const warnings = record.issues.length - errors;
      const origin = record.source === 'edit' ? ' (edited)' : '';
      return (
        `${record.stage} #${record.attempt}${origin}: ` +
        (hasErrors(record.issues)
          ? `${errors} error(s), ${warnings} warning(s)`
          : `checks passed, ${warnings} warning(s)`)
      );
    }
    case 'stage-accepted':
      return `${event.stage}: accepted`;
    case 'plan-checked':
      return event.plan.status === 'found'
        ? `plan: ${event.plan.steps.length} steps`
        : `plan: ${event.status}`;
    case 'review':
      return `review round ${event.round}: ${event.findings.length} finding(s)`;
    case 'finished':
      return undefined;
  }
}
