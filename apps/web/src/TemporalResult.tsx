import type { DesignRun } from '@pddl/contracts/design';
import type { TimedLiteral } from '@pddl/domain/temporal';
import { CodeBlock } from './CodeBlock.js';
import { fact } from './model.js';

type Result = NonNullable<DesignRun['temporal']>;
const timing = { start: 'At start', overall: 'Throughout', end: 'At end' };
const clause = (item: TimedLiteral) => `${timing[item.timing]}: ${fact(item)}`;

export function TemporalResult({
  result,
  restoredFromSaved = false,
}: {
  result: Result;
  restoredFromSaved?: boolean;
}) {
  if (result.status === 'failed')
    return (
      <section className="temporal-result" aria-label="Timed model">
        <h2>Timed model</h2>
        <div className="finding error">
          <strong>Temporal extraction failed</strong>
          <p>{result.error}</p>
        </div>
      </section>
    );

  return (
    <section className="temporal-result" aria-label="Timed model">
      <div className="section-title">
        <h2>Timed model</h2>
        <span className="sheet-label">PDDL 2.1</span>
      </div>
      <p>
        The classifier selects actions with explicit timing. Check each
        duration, timed rule, and inherited default against the description.
      </p>
      <ul className="plain-list">
        {result.detections.map((item) => (
          <li key={item.action}>
            <strong>{item.action.replaceAll('-', ' ')}</strong> ·{' '}
            {item.timed ? 'timed' : 'classical'} · classifier probability{' '}
            {item.probability.toFixed(2)}
          </li>
        ))}
      </ul>
      {result.durativeActions.map((action) => (
        <article className="temporal-action" key={action.name}>
          <h3>{action.name.replaceAll('-', ' ')}</h3>
          <p>Duration: {action.durationSeconds} seconds</p>
          <h4>Conditions</h4>
          <ul>
            {action.conditions.map((c, i) => (
              <li key={i}>{clause(c)}</li>
            ))}
          </ul>
          <h4>Effects</h4>
          <ul>
            {action.effects.map((e, i) => (
              <li key={i}>{clause(e)}</li>
            ))}
          </ul>
        </article>
      ))}
      {!!result.defaultedClauses.length && (
        <details className="temporal-defaults" open>
          <summary>
            Inherited timing defaults ({result.defaultedClauses.length})
          </summary>
          <p>
            These facts came from the classical draft without explicit timing.
            Preconditions use the start; effects use the end.
          </p>
          <ul>
            {result.defaultedClauses.map((item, i) => (
              <li key={i}>
                {item.action}: {item.kind} · {clause(item.clause)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {result.temporalPlan ? (
        <div className="temporal-schedule">
          <h3>Timed schedule</h3>
          <p>
            {result.temporalPlan.status === 'validated'
              ? 'VAL validated this one-step schedule.'
              : restoredFromSaved
                ? 'The saved model was rechecked, but VAL must be rerun to validate this schedule.'
                : 'This one-step schedule is a candidate; it has not passed VAL.'}
          </p>
          <pre className="syntax-code" tabIndex={0} aria-label="Timed schedule">
            <code>{result.temporalPlan.text}</code>
          </pre>
          {result.validationError && (
            <div className="finding error">
              <strong>VAL could not validate the schedule</strong>
              <p>{result.validationError}</p>
            </div>
          )}
        </div>
      ) : (
        <p>No timed schedule is available for this plan.</p>
      )}
      <h3>Timed domain PDDL</h3>
      <CodeBlock
        language="pddl"
        label="Timed domain PDDL"
        code={result.domainPddl}
      />
      <h3>Problem PDDL</h3>
      <CodeBlock
        language="pddl"
        label="Problem PDDL"
        code={result.problemPddl}
      />
      <p className="small">
        The walkthrough below simulates the classical draft. Its steps do not
        validate overlapping or timed execution.
      </p>
    </section>
  );
}
