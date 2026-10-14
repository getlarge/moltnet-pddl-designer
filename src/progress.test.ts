import { describe, expect, it } from 'vitest';

import { formatEvent } from './progress.js';

describe('formatEvent', () => {
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
