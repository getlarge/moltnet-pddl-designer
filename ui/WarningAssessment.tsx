import type { WarningReviewSettings } from '../server/types.js';
import type {
  WarningDecision,
  WarningReviewRecord,
} from '../src/warning-review.js';
import { CodeBlock } from './CodeBlock.js';

export function WarningAssessmentSettings({
  value,
  onChange,
}: {
  value?: WarningReviewSettings;
  onChange: (value?: WarningReviewSettings) => void;
}) {
  return (
    <fieldset className="warning-assessment-settings">
      <legend>Optional warning assessment</legend>
      <label className="check-option">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) =>
            onChange(e.target.checked ? { profileId: '' } : undefined)
          }
        />
        Assess action warnings against my description
      </label>
      <p className="small">
        After you pass Actions, a separate model checks ownership and
        permanent-fact warnings before refinement. This sends your full
        description and accepted model to the classification provider and adds
        paid tasks when warnings exist. It cannot approve the model or find
        every missing requirement.
      </p>
      {value && (
        <label className="field">
          Classification profile name or ID
          <input
            required
            value={value.profileId}
            aria-describedby="classification-profile-help"
            onChange={(e) => onChange({ profileId: e.target.value })}
          />
          <span className="small" id="classification-profile-help">
            Use a configured classification profile with a daemon serving
            classify tasks. Generation profiles alone do not enable assessment.
          </span>
        </label>
      )}
    </fieldset>
  );
}

export function WarningAssessment({
  decisions,
  reviews,
  running,
}: {
  decisions: WarningDecision[];
  reviews: WarningReviewRecord[];
  running: boolean;
}) {
  if (!decisions.length && !reviews.length && !running) return null;
  return (
    <section className="warning-assessment" aria-label="Warning assessment">
      <h3>Warning assessment</h3>
      <p className="small">
        These judgments concern specific warnings, not the correctness of the
        whole process. Only a defect probability of 90% or more requests repair
        by default. You still review the refinement.
      </p>
      {running && (
        <p role="status">
          Checking accepted action warnings against your description…
        </p>
      )}
      {decisions.map((decision) => (
        <details className="finding warning" key={decision.taskId}>
          <summary>
            {decision.issue.path}:{' '}
            {decision.verdict === 'confirmed'
              ? 'Repair requested'
              : decision.verdict === 'dismissed'
                ? 'No repair requested'
                : 'Uncertain; no repair requested'}
            {' · '}
            {(decision.probability * 100).toFixed(1)}% probability of a defect
          </summary>
          <p>{decision.issue.message}</p>
          <p>
            <strong>Question sent</strong>
          </p>
          <p>{decision.question.instructions}</p>
          <dl>
            <dt>Yes means</dt>
            <dd>{decision.question.criteria.true}</dd>
            <dt>No means</dt>
            <dd>{decision.question.criteria.false}</dd>
          </dl>
          <p className="small">
            Context: the original description, accepted types and facts,
            accepted action definitions, and this warning. The model returned a
            number, without an explanation.
          </p>
          <CodeBlock
            language="json"
            label="Classification return (MoltNet format)"
            code={JSON.stringify(
              {
                version: 1,
                answers: {
                  answer: { type: 'bool', probability: decision.probability },
                },
              },
              null,
              2,
            )}
          />
          <p className="small">
            Task: {decision.taskId}. Elapsed:{' '}
            {(decision.durationMs / 1000).toFixed(1)}s.
          </p>
          {decision.usage && (
            <p className="small">
              {decision.usage.provider} / {decision.usage.model};{' '}
              {decision.usage.inputTokens} input
              {' / '}
              {decision.usage.outputTokens} output tokens.
            </p>
          )}
        </details>
      ))}
      {reviews.map((review, i) => (
        <p className="small" key={i}>
          Assessed {review.after.stage} attempt {review.after.attempt}; repair
          threshold {(review.threshold * 100).toFixed(0)}%.
          {review.failure && ` Assessment stopped: ${review.failure.reason}`}
        </p>
      ))}
    </section>
  );
}
