import { useMemo, useState } from 'react';
import {
  applicable,
  apply,
  factKey,
  ground,
  type GroundAction,
} from '@pddl/domain/planner';
import type { DesignRun } from '@pddl/contracts/design';
import { actionLabel, factLabel } from './model.js';
import { useCurrentInView } from './useCurrentInView.js';

export function PlanExplorer({
  run,
  onAction,
}: {
  run: DesignRun;
  onAction: (name: string) => void;
}) {
  const [timeline, setTimeline] = useState<GroundAction[]>([]);
  const [position, setPosition] = useState(0);
  const timelineRail = useCurrentInView<HTMLElement>(position);
  const history = timeline.slice(0, position);
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('');
  const grounded = useMemo(() => {
    if (!run.domain || !run.problem)
      return {
        actions: [],
        rows: [],
        error: 'Complete the model and situation to explore a plan.',
      };
    try {
      return { ...ground(run.domain, run.problem), error: undefined };
    } catch (error) {
      return { actions: [], rows: [], error: (error as Error).message };
    }
  }, [run]);
  if (!run.problem || !run.domain)
    return <p>Complete the model and situation before exploring the plan.</p>;
  const describeAction = (label: string) =>
    actionLabel(label, run.domain!.actions);
  const describeFact = (label: string) =>
    factLabel(label, run.domain!.predicates);
  const initial = new Set(
    run.problem.init.map((a) => factKey(a.predicate, a.args)),
  );
  const state = history.reduce((s, a) => apply(s, a), initial);
  const previous = history.slice(0, -1).reduce((s, a) => apply(s, a), initial);
  const goals = run.problem.goal.map((g) => ({
    text: `${g.negated ? 'not ' : ''}${describeFact(factKey(g.predicate, g.args))}`,
    met: g.negated
      ? !state.has(factKey(g.predicate, g.args))
      : state.has(factKey(g.predicate, g.args)),
  }));
  const reached = goals.every((g) => g.met);
  const available = grounded.actions.filter((a) => applicable(state, a));
  const plan = run.plan?.status === 'found' ? run.plan.steps : [];
  const onPath = history.every((a, i) => a.label === plan[i]);
  const next =
    timeline[position] ??
    (onPath
      ? grounded.actions.find((a) => a.label === plan[position])
      : undefined);
  const followingPlan = timeline.every((a, i) => a.label === plan[i]);
  const displayedSteps = followingPlan ? plan : timeline.map((a) => a.label);
  function goToState(index: number) {
    const sequence = displayedSteps.map((label) =>
      grounded.actions.find((a) => a.label === label),
    );
    let replay = initial;
    for (const action of sequence.slice(0, index)) {
      if (!action || !applicable(replay, action)) return;
      replay = apply(replay, action);
    }
    setTimeline(sequence.filter((a): a is GroundAction => !!a));
    setPosition(index);
    const action = sequence[index - 1];
    setSelected(action?.label ?? '');
    if (action) onAction(action.action);
  }
  const chosen = grounded.actions.find((a) => a.label === selected);
  const actions = grounded.actions.filter((a) => a.label.includes(filter));
  function step(action: GroundAction) {
    if (applicable(state, action)) {
      setTimeline(
        timeline[position]?.label === action.label
          ? timeline
          : [...history, action],
      );
      setPosition(position + 1);
      onAction(action.action);
    }
  }
  return (
    <section className="plan-explorer">
      <div className="section-title">
        <h2>Plan walkthrough</h2>
        <span
          className={`stamp${!run.needsReview?.length && reached ? ' passed' : ''}`}
        >
          {run.needsReview?.length
            ? 'DRAFT'
            : reached
              ? 'GOAL REACHED'
              : 'STEP THROUGH'}
        </span>
      </div>
      <p>
        {run.needsReview?.length
          ? 'This plan was recomputed from your edits. Pass the marked stages before treating it as approved.'
          : 'A checked plan shows one way to reach the goal. Try it against the process you described.'}
      </p>
      {run.plan?.status !== 'found' && (
        <div className="finding">
          <strong>
            {run.plan?.status === 'limit'
              ? 'Search limit reached'
              : 'No plan found'}
          </strong>
          <p>{run.plan?.reason}</p>
          {run.reachability?.unreachableGoals.map((g) => (
            <p key={g}>Cannot become true: {describeFact(g)}</p>
          ))}
        </div>
      )}
      {grounded.error && <p role="alert">{grounded.error}</p>}
      <div className="simulation-bar">
        <strong aria-live="polite">
          {reached
            ? 'Goal reached'
            : !available.length
              ? 'Dead end · no action applies'
              : history.length
                ? `After step ${history.length}`
                : 'Initial state'}
        </strong>
        <div className="button-row">
          <button
            className="primary"
            disabled={!next || !applicable(state, next)}
            onClick={() => next && step(next)}
          >
            Next plan step
          </button>
          <button
            disabled={!history.length}
            onClick={() => setPosition(Math.max(0, position - 1))}
          >
            Undo
          </button>
          <button
            disabled={!history.length}
            onClick={() => {
              setTimeline([]);
              setPosition(0);
              setSelected('');
            }}
          >
            Reset
          </button>
        </div>
      </div>
      {!onPath && (
        <p>
          You are exploring another path. Undo or reset to follow the planner’s
          steps.
        </p>
      )}
      <nav
        ref={timelineRail}
        className="plan-timeline"
        aria-label="Plan progression"
      >
        <ol>
          <li>
            <button
              aria-current={position === 0 ? 'step' : undefined}
              onClick={() => goToState(0)}
            >
              <span>Start</span>
              <strong>Initial facts</strong>
            </button>
          </li>
          {displayedSteps.map((label, i) => (
            <li key={`${label}-${i}`}>
              <button
                aria-current={position === i + 1 ? 'step' : undefined}
                className={i + 1 < position ? 'visited' : ''}
                onClick={() => goToState(i + 1)}
              >
                <span>
                  Step {i + 1}
                  {position === i + 1 ? ' · viewing' : ''}
                </span>
                <strong>{describeAction(label)}</strong>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <p className="small">
        Select Start or a step to inspect its resulting state. Participants are
        labeled type: object in both actions and facts; numbered types follow
        each definition’s parameter order.
      </p>
      <div className="simulation-grid">
        <section>
          <h3>
            {position ? `Changes at step ${position}` : 'Starting situation'}
          </h3>
          {position ? (
            <>
              <p>{describeAction(history[position - 1]!.label)}</p>
              <h4>Made true</h4>
              <ul className="plain-list changes-added">
                {[...state]
                  .filter((f) => !previous.has(f))
                  .map((f) => (
                    <li key={f}>{describeFact(f)}</li>
                  ))}
              </ul>
              {![...state].some((f) => !previous.has(f)) && (
                <p>No new facts.</p>
              )}
              <h4>Made false</h4>
              <ul className="plain-list changes-removed">
                {[...previous]
                  .filter((f) => !state.has(f))
                  .map((f) => (
                    <li key={f}>{describeFact(f)}</li>
                  ))}
              </ul>
              {![...previous].some((f) => !state.has(f)) && (
                <p>No facts removed.</p>
              )}
            </>
          ) : (
            <p>
              No action has run. These are the initial facts from Situation.
            </p>
          )}
          <h3>Goal facts</h3>
          <ul className="plain-list">
            {goals.map((g, i) => (
              <li key={i}>
                <span className={g.met ? 'goal-met' : 'goal-pending'}>
                  {g.met ? 'Met' : 'Needed'}
                </span>{' '}
                {g.text}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>
            Facts now <span className="count">{state.size}</span>
          </h3>
          <ul
            className="fact-list"
            tabIndex={0}
            aria-label="Current facts and latest changes"
          >
            {[...state].sort().map((f) => (
              <li key={f} className={!previous.has(f) ? 'added' : ''}>
                {!previous.has(f) && <span>Added · </span>}
                {describeFact(f)}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <details className="alternative-actions">
        <summary>Explore other actions and blocked steps</summary>
        <p className="small">
          Choose a concrete action to inspect its prerequisites or branch from
          the state currently shown. Reset returns to the planned route.
        </p>
        <div className="grounding-list">
          {grounded.rows.map((row) => (
            <button
              key={row.action}
              className="grounding-row"
              onClick={() => {
                setFilter(row.action);
                onAction(row.action);
              }}
            >
              <span>{row.action.replaceAll('-', ' ')}</span>
              <span>
                {row.instances} versions
                {row.emptyParameters.length
                  ? ` · no objects for ${row.emptyParameters.join(', ')}`
                  : ''}
              </span>
            </button>
          ))}
        </div>
        <label className="field">
          Find a concrete action
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by action or object"
          />
        </label>
        <label className="field">
          Concrete version
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              const action = grounded.actions.find(
                (a) => a.label === e.target.value,
              );
              if (action) onAction(action.action);
            }}
          >
            <option value="">Choose an action</option>
            {actions.slice(0, 200).map((a) => (
              <option key={a.label} value={a.label}>
                {applicable(state, a) ? 'Can run: ' : 'Blocked: '}
                {describeAction(a.label)}
              </option>
            ))}
          </select>
        </label>
        {actions.length > 200 && (
          <p>
            Showing 200 of {actions.length} versions. Narrow the filter to find
            another.
          </p>
        )}
        {chosen && (
          <div className="action-explanation">
            <h4>{describeAction(chosen.label)}</h4>
            <details>
              <summary>Planner notation</summary>
              <p className="small">
                The action name comes first; the remaining names are objects
                bound to its parameters in declaration order.
              </p>
              <code>{chosen.label}</code>
            </details>
            {chosen.pre
              .filter((f) => !state.has(f))
              .map((f) => (
                <p key={f}>Missing: {describeFact(f)}</p>
              ))}
            {chosen.neg
              .filter((f) => state.has(f))
              .map((f) => (
                <p key={f}>Must be false: {describeFact(f)}</p>
              ))}
            {applicable(state, chosen) && (
              <p>All needed facts hold in the current state.</p>
            )}
            <p>Adds: {chosen.add.map(describeFact).join('; ') || 'nothing'}</p>
            <p>
              Removes: {chosen.del.map(describeFact).join('; ') || 'nothing'}
            </p>
            <button
              disabled={!applicable(state, chosen)}
              onClick={() => step(chosen)}
            >
              Try this action
            </button>
          </div>
        )}
      </details>
    </section>
  );
}
