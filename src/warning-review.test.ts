import { describe, expect, it } from 'vitest';

import { checkActions } from './check.js';
import {
  blocksActions,
  blocksPredicates,
  blocksTypes,
} from './test-fixtures.js';
import {
  isWarningCandidate,
  warningQuestion,
  warningVerdict,
} from './warning-review.js';

describe('warning review judgments', () => {
  it.each([
    [0, 'dismissed'],
    [0.1, 'dismissed'],
    [0.1001, 'uncertain'],
    [0.5, 'uncertain'],
    [0.8999, 'uncertain'],
    [0.9, 'confirmed'],
    [1, 'confirmed'],
  ] as const)(
    'interprets p=%s as %s at the default threshold',
    (p, verdict) => {
      expect(warningVerdict(p)).toBe(verdict);
    },
  );

  it('uses a configurable symmetric threshold', () => {
    expect(warningVerdict(0.8, 0.8)).toBe('confirmed');
    expect(warningVerdict(0.2, 0.8)).toBe('dismissed');
    expect(warningVerdict(0.21, 0.8)).toBe('uncertain');
  });

  it.each([NaN, Infinity, -0.1, 1.1])('rejects invalid p=%s', (p) => {
    expect(() => warningVerdict(p)).toThrow('probability');
  });

  it.each([NaN, 0, 0.5, 1])(
    'rejects overlapping or invalid threshold %s',
    (threshold) => {
      expect(() => warningVerdict(0.5, threshold)).toThrow('threshold');
    },
  );

  it('selects only supported semantic warnings, never structural errors', () => {
    const issues = checkActions(
      blocksTypes.types,
      blocksPredicates.predicates,
      blocksActions,
    );
    expect(issues.filter(isWarningCandidate)).toHaveLength(3);
    expect(
      isWarningCandidate({
        severity: 'error',
        code: 'unlinked-parameters',
        path: 'actions/x',
        message: 'x',
      }),
    ).toBe(false);
    expect(
      isWarningCandidate({
        severity: 'warning',
        path: 'actions/x',
        message: 'action has no effects',
      }),
    ).toBe(false);
    expect(() =>
      warningQuestion({
        severity: 'warning',
        path: 'actions/x',
        message: 'other warning',
      }),
    ).toThrow('unsupported warning');
  });
});
