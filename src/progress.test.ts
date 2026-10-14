import { describe, expect, it } from 'vitest';

import { formatEvent } from './progress.js';
import { warningQuestion } from './warning-review.js';

describe('formatEvent', () => {
  it('shows classification progress and the durable task behind its judgment', () => {
    const after = { stage: 'actions' as const, attempt: 2 };
    const issue = {
      severity: 'warning' as const,
      code: 'permanent-fact',
      path: 'predicates/approved',
      message: 'no action deletes approved',
    };
    expect(
      formatEvent({ type: 'warning-review-started', after, candidates: 1 }),
    ).toBe('warning review after actions #2: 1 question(s)');
    expect(
      formatEvent({
        type: 'warning-review-result',
        after,
        decision: {
          issue,
          question: warningQuestion(issue),
          probability: 0.99,
          verdict: 'confirmed',
          taskId: 'classification-task',
          durationMs: 1,
        },
      }),
    ).toContain('confirmed (p=0.99, task classification-task)');
  });
  it('summarises a stage result by its check findings', () => {
    // Arrange
    const event = {
      type: 'stage-result' as const,
      record: {
        stage: 'types' as const,
        attempt: 2,
        source: 'edit' as const,
        brief: '',
        result: {},
        issues: [
          { severity: 'error' as const, path: 'types/a', message: 'x' },
          { severity: 'warning' as const, path: 'types/b', message: 'y' },
        ],
        durationMs: 0,
      },
    };

    // Act
    const line = formatEvent(event);

    // Assert
    expect(line).toBe('types #2 (edited): 1 error(s), 1 warning(s)');
  });

  it('has no line for the finished event', () => {
    // Act
    const line = formatEvent({
      type: 'finished',
      run: {} as never,
    });

    // Assert
    expect(line).toBeUndefined();
  });
});
