import { useState } from 'react';
import type { ClassifyInput } from '@themoltnet/sdk';
import type { Domain } from '@pddl/domain/ir';
import type { SourceCheckRecord } from '@pddl/contracts/source-check';
import { groundingTargets } from '@pddl/domain/source-grounding-targets';
import { describeGroundingTarget } from '@pddl/domain/source-claim';
import type {
  GroundingTarget,
  GroundingAnswer,
} from '@pddl/domain/source-grounding';
import { api } from './model.js';
import { CodeBlock } from './CodeBlock.js';

const outcomeLabels = {
  supported: 'Matches description',
  contradicted: 'Conflicts with description',
  not_established: 'Not settled by description',
};
type Claim = {
  statement: string;
  target: GroundingTarget;
  formalStatement?: string;
  wording?: 'readable' | 'formal';
  participants?: Record<string, string>;
};
function ClaimReading({
  claim,
  showFormal = true,
}: {
  claim: Claim;
  showFormal?: boolean;
}) {
  return (
    <div className="claim-reading">
      <p>{claim.statement}</p>
      {claim.wording === 'formal' && (
        <p className="small">
          This draft has no readable meanings for this rule yet. Use Correct to
          add them, or inspect the formal wording.
        </p>
      )}
      {showFormal && claim.formalStatement && (
        <details>
          <summary>Formal rule and participants</summary>
          <p>{claim.formalStatement}</p>
          {claim.participants && (
            <dl>
              {Object.entries(claim.participants).map(([parameter, label]) => (
                <div key={parameter}>
                  <dt>{parameter}</dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          )}
        </details>
      )}
    </div>
  );
}

export function SourceCheck({
  domain,
  runId,
  gateId,
  attempt,
  record,
  onSnapshot,
  onNote,
}: {
  domain: Domain;
  runId?: string;
  gateId?: string;
  attempt: number;
  record?: SourceCheckRecord;
  onSnapshot: (snapshot: import('@pddl/contracts/api').RunSnapshot) => void;
  onNote: (message: string) => void;
}) {
  const targets = groundingTargets(domain);
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [profile, setProfile] = useState('');
  const [preview, setPreview] = useState<ClassifyInput>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const checking = record?.status === 'checking';
  const active = record?.attempt === attempt ? record : undefined;
  async function previewCheck() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ input: ClassifyInput }>(
        `runs/${runId}/source-check`,
        {
          gateId,
          targets: selected.map((i) => targets[i]),
          preview: true,
        },
      );
      setPreview(result.input);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function runCheck() {
    setBusy(true);
    setError('');
    try {
      const next = await api<import('@pddl/contracts/api').RunSnapshot>(
        `runs/${runId}/source-check`,
        {
          gateId,
          targets: selected.map((i) => targets[i]),
          profile,
        },
      );
      setPreview(undefined);
      setChoosing(false);
      onSnapshot(next);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const answers = active?.output?.answers as
    Record<string, GroundingAnswer> | undefined;
  const claims = active?.input.state.claims as
    Record<string, Claim> | undefined;
  const judgments = Object.entries(answers ?? {}).sort(([, a], [, b]) => {
    const priority = { contradicted: 0, not_established: 1, supported: 2 };
    return priority[a.choice] - priority[b.choice];
  });
  const count = (choice: GroundingAnswer['choice']) =>
    judgments.filter(([, answer]) => answer.choice === choice).length;
  return (
    <section
      className="source-check"
      aria-label="Compare actions with your description"
    >
      <details className="source-check-panel" open={active ? true : undefined}>
        <summary>
          {checking
            ? '2. Checking selected rules…'
            : active?.status === 'complete' && !choosing && !preview
              ? '2. Review source-check results'
              : '2. Check rules against your description (optional)'}
        </summary>
        {(!active || choosing || active.status === 'failed') &&
          !preview &&
          !checking &&
          gateId && (
            <div className="source-check-selection">
              <h4>Choose rules to check</h4>
              <p className="small">
                Select up to 20 draft rules to compare with your description.
                Preview is free; running the check makes one paid model call.
              </p>
              <div className="source-check-targets">
                {[...new Set(targets.map((target) => target.action))].map(
                  (action) => (
                    <fieldset className="source-check-action" key={action}>
                      <legend>{action.replaceAll('-', ' ')}</legend>
                      {targets.map(
                        (target, index) =>
                          target.action === action && (
                            <label
                              key={JSON.stringify(target)}
                              className="source-check-option"
                            >
                              <input
                                type="checkbox"
                                checked={selected.includes(index)}
                                disabled={
                                  busy ||
                                  checking ||
                                  (!selected.includes(index) &&
                                    selected.length >= 20)
                                }
                                onChange={(e) => {
                                  setSelected(
                                    e.target.checked
                                      ? [...selected, index]
                                      : selected.filter((v) => v !== index),
                                  );
                                  setPreview(undefined);
                                }}
                              />
                              <span>
                                {
                                  describeGroundingTarget(domain, target)
                                    .statement
                                }
                              </span>
                            </label>
                          ),
                      )}
                    </fieldset>
                  ),
                )}
              </div>
              <p className="small">
                {selected.length} of {targets.length} rules selected.
              </p>
              <button
                type="button"
                onClick={previewCheck}
                disabled={busy || checking || !selected.length}
              >
                Preview source check
              </button>
              {active?.status === 'complete' && (
                <button type="button" onClick={() => setChoosing(false)}>
                  Back to results
                </button>
              )}
            </div>
          )}
        {preview && gateId && !checking && (
          <div className="source-check-preview">
            <h4>
              Ready to compare {Object.keys(preview.questions).length} rules
            </h4>
            <p className="small">
              One paid classify task sends your original description and these
              model claims to the selected provider. It does not generate or
              change actions.
            </p>
            <button type="button" onClick={() => setPreview(undefined)}>
              Change selection
            </button>
            <ol
              className="source-check-claims"
              aria-label="Claims the model will check"
            >
              {Object.entries(
                preview.state.claims as Record<string, Claim>,
              ).map(([id, claim]) => (
                <li key={id}>
                  <ClaimReading claim={claim} />
                </li>
              ))}
            </ol>
            <p className="small">
              These sentences describe the draft, including possible mistakes.
              Check that they mean what the formal rules say. Readable meanings
              come from generation and remain part of your review.
            </p>
            <details>
              <summary>Exact source, claims and questions to be sent</summary>
              <CodeBlock
                code={JSON.stringify(preview, null, 2)}
                language="json"
                label="Source-check request"
              />
            </details>
            <label className="field">
              Classification profile name or ID
              <input
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
                placeholder="A configured classification profile"
                disabled={busy || checking}
              />
              <span className="small">
                Choose a profile with models.classification and a worker serving
                classify tasks. Generation profiles do not supply this check.
              </span>
            </label>
            <button
              type="button"
              className="primary"
              onClick={runCheck}
              disabled={busy || checking || !profile.trim()}
            >
              {checking
                ? 'Comparing with your description…'
                : 'Run source check'}
            </button>
          </div>
        )}
        {checking && (
          <p role="status">
            Comparing selected rules. Your draft stays here; Pass and
            corrections resume when the check returns. You can still Withdraw.
          </p>
        )}
        {active?.status === 'failed' && (
          <div role="alert">
            <p>{active.failure} Your draft is unchanged.</p>
            {active.taskId && <p className="small">Task {active.taskId}</p>}
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        {active && answers && claims && !choosing && !preview && (
          <div className="source-check-results">
            <div className="source-check-results-heading">
              <h4>{judgments.length} rules checked</h4>
              {gateId && (
                <button type="button" onClick={() => setChoosing(true)}>
                  Check other rules
                </button>
              )}
            </div>
            <p className="source-check-summary">
              {count('contradicted')} conflicting · {count('not_established')}{' '}
              unanswered · {count('supported')} matching
            </p>
            <p className="small">
              Review conflicts and unanswered rules before passing Actions.
              These are model judgments; you decide what to correct.
            </p>
            <div className="source-check-judgments">
              {judgments.map(([id, answer]) => (
                <article
                  className={`source-check-result ${answer.choice}`}
                  key={id}
                >
                  <div className="source-check-result-heading">
                    <h5>{claims[id].target.action.replaceAll('-', ' ')}</h5>
                    <span className="source-check-verdict">
                      {outcomeLabels[answer.choice]}
                    </span>
                  </div>
                  <ClaimReading claim={claims[id]} showFormal={false} />
                  <div className="source-check-result-tools">
                    {gateId && answer.choice !== 'supported' && (
                      <button
                        type="button"
                        onClick={() =>
                          onNote(
                            `Please review this action rule against the process description: ${claims[id].statement}\n${answer.choice === 'contradicted' ? 'The source check found a contradiction. Correct the action to match the source.' : 'The source check found insufficient evidence. My clarification: '}`,
                          )
                        }
                      >
                        {answer.choice === 'contradicted'
                          ? 'Prepare correction note'
                          : 'Prepare clarification note'}
                      </button>
                    )}
                    <details>
                      <summary>Check details</summary>
                      <p className="small">
                        {(answer.probabilities[answer.choice] * 100).toFixed(0)}
                        % model probability for this label. This is not measured
                        accuracy or approval of the model.
                      </p>
                      {claims[id].formalStatement && (
                        <>
                          <h6>Formal rule</h6>
                          <p>{claims[id].formalStatement}</p>
                          {claims[id].participants && (
                            <dl className="claim-participants">
                              {Object.entries(claims[id].participants!).map(
                                ([parameter, label]) => (
                                  <div key={parameter}>
                                    <dt>{parameter}</dt>
                                    <dd>{label}</dd>
                                  </div>
                                ),
                              )}
                            </dl>
                          )}
                        </>
                      )}
                      <h6>Context and question sent; answer received</h6>
                      <p className="small">
                        State is shared by all checked rules. The question and
                        answer below belong to this rule.
                      </p>
                      <CodeBlock
                        code={JSON.stringify(
                          {
                            state: active.input.state,
                            question: active.input.questions[id],
                            answer,
                          },
                          null,
                          2,
                        )}
                        language="json"
                        label="Classifier state, question and answer"
                      />
                    </details>
                  </div>
                </article>
              ))}
            </div>
            <details
              className="source-check-evidence"
              aria-label="Shared evidence for all checked rules"
            >
              <summary>
                Task details and raw response · all{' '}
                {Object.keys(answers).length} rules
              </summary>
              <details>
                <summary>
                  Exact request and raw response — all checked rules
                </summary>
                <CodeBlock
                  code={JSON.stringify(
                    { input: active.input, output: active.output },
                    null,
                    2,
                  )}
                  language="json"
                  label="Complete source-check evidence"
                />
              </details>
              {active.usage && (
                <p className="small">
                  {active.usage.provider} / {active.usage.model} ·{' '}
                  {active.usage.inputTokens} input tokens ·{' '}
                  {active.usage.outputTokens} output tokens
                </p>
              )}
              <p className="small">
                Task {active.taskId} · {(active.durationMs / 1000).toFixed(1)}s
                · draft attempt {active.attempt}. The model returned labels and
                probabilities, not an explanation.
              </p>
            </details>
          </div>
        )}
      </details>
      {!gateId && !answers && (
        <p className="small">
          Source checks are available while reviewing a valid live Actions
          draft. Opening this proof does not create tasks.
        </p>
      )}
    </section>
  );
}
