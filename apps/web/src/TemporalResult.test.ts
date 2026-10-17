import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DesignRun } from '@pddl/contracts/design';
import { TemporalResult } from './TemporalResult.js';

type Result = NonNullable<DesignRun['temporal']>;

const complete: Result = {
  status: 'complete',
  detections: [{ action: 'load-parcel', probability: 0.97, timed: true }],
  durativeActions: [],
  defaultedClauses: [],
  domainPddl: '(define (domain loading))',
  problemPddl: '(define (problem parcel))',
  temporalPlan: {
    status: 'candidate',
    text: '0: (load-parcel parcel-one) [120]\n',
  },
};

const render = (result: Result, restoredFromSaved = false) =>
  renderToStaticMarkup(
    createElement(TemporalResult, { result, restoredFromSaved }),
  );

describe('temporal result', () => {
  it('distinguishes a candidate schedule from a VAL-validated schedule', () => {
    expect(render(complete)).toContain(
      'This one-step schedule is a candidate; it has not passed VAL.',
    );
    expect(
      render({
        ...complete,
        temporalPlan: { ...complete.temporalPlan!, status: 'validated' },
      }),
    ).toContain('VAL validated this one-step schedule.');
  });

  it('shows a saved-run warning and historical VAL error', () => {
    const html = render(
      { ...complete, validationError: 'VAL rejected the schedule.' },
      true,
    );
    expect(html).toContain('VAL must be rerun to validate this schedule.');
    expect(html).toContain('VAL rejected the schedule.');
  });

  it('shows temporal extraction failure without a schedule claim', () => {
    const html = render({ status: 'failed', error: 'Worker failed.' });
    expect(html).toContain('Temporal extraction failed');
    expect(html).toContain('Worker failed.');
    expect(html).not.toContain('VAL validated');
  });
});
