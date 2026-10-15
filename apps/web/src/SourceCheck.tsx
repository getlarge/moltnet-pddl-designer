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
  supported: 'Supported by your description',
  contradicted: 'Your description disagrees',
  not_established: 'Your description does not settle this',
};
type Claim = {
  statement: string;
  target: GroundingTarget;
  formalStatement?: string;
  wording?: 'readable' | 'formal';
  participants?: Record<string, string>;
};
function ClaimReading({ claim }: { claim: Claim }) {
  return (
    <div className="claim-reading">
      <p>{claim.statement}</p>
      {claim.wording === 'formal' && (
        <p className="small">
          This draft has no readable meanings for this rule yet. Use Correct to
          add them, or inspect the formal wording.
        </p>
      )}
      {claim.formalStatement && (
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
  return (
    <section
      className="source-check"
      aria-label="Compare actions with your description"
    >
      <h3>Compare actions with your description</h3>
      <p>
        A decision model can check specific action rules against your words.
        Choose what to check; you still decide whether to pass Actions.
      </p>
      <ol
        className="source-check-flow"
        aria-label="Decision task in the workflow"
      >
        <li>Draft + local checks</li>
        <li aria-current={checking ? 'step' : undefined}>
          {checking
            ? 'Decision task running'
            : active?.status === 'complete'
              ? 'Decision task returned'
              : 'Optional decision task'}
        </li>
        <li>You review and decide</li>
      </ol>
      {gateId && (
        <details className="source-check-selection" open={!active}>
          <summary>Choose rules to check</summary>
          <p className="small">
            Select up to 20 rules for one classify task. These checks cover the
            selected rules, not every missing requirement.
          </p>
          <div className="source-check-targets">
            {targets.map((target, index) => (
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
                    (!selected.includes(index) && selected.length >= 20)
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
                  <strong>{target.action.replaceAll('-', ' ')}</strong>
                  <br />
                  {describeGroundingTarget(domain, target).statement}
                </span>
              </label>
            ))}
          </div>
          <p className="small">
            {selected.length} of {targets.length} available rules selected. You
            and the model will read the same sentences. Previewing runs locally
            and makes no model call.
          </p>
          <button
            type="button"
            onClick={previewCheck}
            disabled={busy || checking || !selected.length}
          >
            Preview source check
          </button>
        </details>
      )}
      {preview && gateId && (
        <div className="source-check-preview">
          <h4>
            Ready to compare {Object.keys(preview.questions).length} rules
          </h4>
          <p className="small">
            One paid classify task sends your original description and these
            model claims to the selected provider. It does not generate or
            change actions.
          </p>
          <p>
            For each claim: does your description support it, contradict it, or
            leave it unanswered?
          </p>
          <ol
            className="source-check-claims"
            aria-label="Claims the model will check"
          >
            {Object.entries(preview.state.claims as Record<string, Claim>).map(
              ([id, claim]) => (
                <li key={id}>
                  <ClaimReading claim={claim} />
                </li>
              ),
            )}
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
            {checking ? 'Comparing with your description…' : 'Run source check'}
          </button>
        </div>
      )}
      {checking && (
        <p role="status">
          Comparing selected rules. Your draft stays here; Pass and corrections
          resume when the check returns. You can still Withdraw.
        </p>
      )}
      {active?.status === 'failed' && (
        <div role="alert">
          <p>{active.failure} Your draft is unchanged.</p>
          {active.taskId && <p className="small">Task {active.taskId}</p>}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {active && answers && claims && (
        <div className="source-check-results">
          <h4>Read these judgments before passing Actions</h4>
          <div className="source-check-judgments">
            {Object.entries(answers).map(([id, answer]) => (
              <article
                className={`source-check-result ${answer.choice}`}
                key={id}
              >
                <h4>{outcomeLabels[answer.choice]}</h4>
                <ClaimReading claim={claims[id]} />
                <p className="small">
                  {(answer.probabilities[answer.choice] * 100).toFixed(0)}%
                  model probability for this label. This is not a measured
                  accuracy score or approval of the model.
                </p>
                {answer.choice === 'contradicted' && (
                  <p>
                    Review this rule against your description. Correct it
                    directly or return the draft with a correction note.
                  </p>
                )}
                {answer.choice === 'not_established' && (
                  <p>
                    The model did not establish this rule from the description.
                    Compare it with the source; clarify with the process author
                    if needed.
                  </p>
                )}
                {gateId && answer.choice !== 'supported' && (
                  <button
                    type="button"
                    onClick={() =>
                      onNote(
                        `Please review this action rule against the process description: ${claims[id].statement}\n${answer.choice === 'contradicted' ? 'The source check found a contradiction. Correct the action to match the source.' : 'The source check found insufficient evidence. My clarification: '}`,
                      )
                    }
                  >
                    Prepare correction note
                  </button>
                )}
                <details>
                  <summary>
                    Question, criteria and returned distribution
                  </summary>
                  <p>{active.input.questions[id].instructions}</p>
                  <CodeBlock
                    code={JSON.stringify(
                      { criteria: active.input.questions[id].criteria, answer },
                      null,
                      2,
                    )}
                    language="json"
                    label="Decision evidence"
                  />
                </details>
              </article>
            ))}
          </div>
          <section
            className="source-check-evidence"
            aria-label="Shared evidence for all checked rules"
          >
            <h4>
              Shared evidence for all {Object.keys(answers).length} checked
              rules
            </h4>
            <p className="small">
              This request and task record apply to every judgment above, across
              all checked actions.
            </p>
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
              Task {active.taskId} · {(active.durationMs / 1000).toFixed(1)}s ·
              draft attempt {active.attempt}. The model returned labels and
              probabilities, not an explanation.
            </p>
          </section>
        </div>
      )}
      {!gateId && !answers && (
        <p className="small">
          Source checks are available while reviewing a valid live Actions
          draft. Opening this proof does not create tasks.
        </p>
      )}
    </section>
  );
}
