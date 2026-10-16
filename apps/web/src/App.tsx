import { useEffect, useMemo, useState } from 'react';
import type { DesignRun, StageDecision } from '@pddl/contracts/design';
import type { StageName } from '@pddl/contracts/stages';
import type { ActionDef, Atom } from '@pddl/domain/ir';
import type { Issue } from '@pddl/domain/check';
import type { RunInput, RunSnapshot, SavedItem } from '@pddl/contracts/api';
import { sourceLines, sourceSentences } from '@pddl/domain/provenance';
import {
  api,
  explain,
  fact,
  labels,
  latest,
  records,
  readingGuide,
  stages,
  stageState,
  type ViewStage,
} from './model.js';
import { emptyStage, StageEditor } from './StageEditor.js';
import { PlanExplorer } from './PlanExplorer.js';
import { FactDefinition } from './FactDefinition.js';
import { CodeBlock } from './CodeBlock.js';
import { SourceCheck } from './SourceCheck.js';
import { useCurrentInView } from './useCurrentInView.js';

type Example = {
  name: string;
  description: string;
  problemDescription: string;
};
type Saved = { id: string; run: DesignRun };
const initialInput: RunInput = {
  description: '',
  problemDescription: '',
  domainName: 'my-process',
  problemName: 'my-situation',
  teamId: '',
  diaryId: '',
  profileId: '',
};
function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function atoms(value: unknown): Atom[] {
  return Array.isArray(value)
    ? value.filter(
        (a) =>
          a &&
          typeof a.predicate === 'string' &&
          Array.isArray(a.args) &&
          a.args.every((v: unknown) => typeof v === 'string'),
      )
    : [];
}
function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function CheckFinding({ finding }: { finding: Issue }) {
  const pairing = finding.code === 'unlinked-parameters';
  return (
    <details
      className={`finding ${finding.severity}`}
      open={finding.severity === 'error'}
    >
      <summary>
        {finding.severity === 'error'
          ? 'Correction required'
          : pairing
            ? 'Check which participants can act together'
            : 'Check with the author'}
      </summary>
      {pairing ? (
        <>
          <p>
            The prerequisites leave some participants independent. The planner
            can choose any combination that satisfies those prerequisites.
          </p>
          <p>
            Is that allowed in your process? If yes, no change is needed. If a
            participant must be assigned to a particular item or partner, add a
            fact expressing that relationship and require it before this action.
          </p>
          <p className="small">Technical check: {finding.message}</p>
        </>
      ) : (
        <p>{finding.message}</p>
      )}
      <span className="small">{finding.path}</span>
    </details>
  );
}

function ProfileGuidance({
  input,
  onChange,
}: {
  input: RunInput;
  onChange: (input: RunInput) => void;
}) {
  const guidance: Record<StageName, string> = {
    types: 'Extract the kinds of things in your process.',
    predicates: 'Identify facts and relationships between those things.',
    actions:
      'Model prerequisites and what each action changes. Consider a stronger reasoning model.',
    refine:
      'Check interactions and repair the action model. Consider a stronger reasoning model.',
    problem:
      'Translate the concrete situation into objects, starting facts, and goals.',
  };
  return (
    <>
      <p className="small" id="profile-help">
        A profile selects the model, shared instructions, and tool permissions.
        Start with legreffier-pddl-designer-v1, or another configured input-only
        generation profile in this team. Each step receives its own
        instructions.
      </p>
      <details>
        <summary>Choose profiles by step</summary>
        <p className="small">
          Leave a field empty to use the default generation profile. Use an
          existing profile name or ID. More profiles are optional; compare the
          results before choosing a larger model.
        </p>
        {Object.entries(guidance).map(([name, hint]) => {
          const stage = name as StageName;
          return (
            <label className="field" key={stage}>
              {labels[stage]} profile
              <input
                value={input.stageProfiles?.[stage] ?? ''}
                placeholder="Use default generation profile"
                aria-describedby={`profile-${stage}-help`}
                onChange={(e) => {
                  const stageProfiles = { ...input.stageProfiles };
                  if (e.target.value.trim())
                    stageProfiles[stage] = e.target.value;
                  else delete stageProfiles[stage];
                  onChange({ ...input, stageProfiles });
                }}
              />
              <span className="small" id={`profile-${stage}-help`}>
                {hint}
              </span>
            </label>
          );
        })}
      </details>
      <details>
        <summary>Set up profiles and workers</summary>
        <p className="small">
          Create the profile and bind its tool policy in MoltNet first. Start a
          daemon worker for every selected profile in the same team, serving
          freeform tasks. A profile with no worker leaves its step waiting.
        </p>
        <p className="small">
          Keep modeling profiles input-only: no workspace or network access is
          needed. Static checks and the planner run locally without a profile.
          Optional classification review has a separate profile and is currently
          available through the CLI.
        </p>
        <p className="small">
          See README.md → Runtime profiles for setup commands, model selection,
          and troubleshooting. Saved proofs can be read and manually edited
          without a daemon; generating corrections needs these workers again.
        </p>
      </details>
    </>
  );
}

export function App() {
  const [page, setPage] = useState<'new' | 'rack' | 'proof'>('new');
  const [input, setInput] = useState<RunInput>(initialInput);
  const [examples, setExamples] = useState<Example[]>([]);
  const [selectedExample, setSelectedExample] = useState(
    () => new URLSearchParams(location.search).get('example') ?? '',
  );
  const [rack, setRack] = useState<SavedItem[]>([]);
  const [snapshot, setSnapshot] = useState<RunSnapshot>();
  const [saved, setSaved] = useState<Saved>();
  const [recoverableRun, setRecoverableRun] = useState<RunSnapshot>();
  const [stage, setStage] = useState<ViewStage>('types');
  const stageRail = useCurrentInView<HTMLOListElement>(`${page}/${stage}`);
  const [selectedLine, setSelectedLine] = useState<number>();
  const [selectedMark, setSelectedMark] = useState('');
  const [construction, setConstruction] = useState(false);
  const [showDescription, setShowDescription] = useState(true);
  const [showPlanDescription, setShowPlanDescription] = useState(false);
  const descriptionVisible =
    stage === 'plan' ? showPlanDescription : showDescription;
  const [editor, setEditor] = useState(false);
  const [gateMode, setGateMode] = useState<'note' | 'withdraw'>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connected, setConnected] = useState(true);
  const [clock, setClock] = useState(Date.now());
  const [runsDirectory, setRunsDirectory] = useState('runs/');
  const run = saved?.run ?? snapshot?.run;
  const correlationId =
    run?.input.correlationId ?? snapshot?.input.correlationId;
  const rows = records(snapshot, run);
  const record = latest(rows, stage);
  const description =
    run?.input.description ?? snapshot?.input.description ?? input.description;
  const sentences = useMemo(() => sourceSentences(description), [description]);
  const result = obj(record?.result);
  const key = stage === 'refine' ? 'actions' : stage;
  const marks = (Array.isArray(result[key]) ? result[key] : []) as unknown[];
  const gate = snapshot?.gate;
  const gateId = gate?.id;
  const gateStage = gate?.stage;
  const hasPlan = !!snapshot?.run?.plan;
  const isGate = gate?.stage === stage;
  const findings = isGate ? gate.issues : (record?.issues ?? []);
  const ownsFinding = (name: string, finding: Issue) =>
    ['actions', 'refine'].includes(stage) &&
    (finding.path === `actions/${name}` ||
      finding.path.startsWith(`actions/${name}/`));
  const stageFindings = editor
    ? findings
    : findings.filter(
        (finding) =>
          !marks.some((raw) => {
            const name = text(obj(raw).name);
            return !!name && ownsFinding(name, finding);
          }),
      );
  const canPass = !!record && !findings.some((i) => i.severity === 'error');
  const sourceChecking = snapshot?.sourceCheck?.status === 'checking';
  const editable = stage !== 'plan' && (!!saved || isGate);
  const active = !!snapshot && ['running', 'awaiting'].includes(snapshot.state);
  const allActionsValue =
    run?.domain?.actions ??
    (obj(latest(rows, 'refine')?.result).actions as ActionDef[] | undefined) ??
    (obj(latest(rows, 'actions')?.result).actions as ActionDef[] | undefined) ??
    [];
  const allActions: ActionDef[] = Array.isArray(allActionsValue)
    ? allActionsValue.filter((a) => a && typeof a.name === 'string')
    : [];
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openSaved(id: string) {
    const data = await api<DesignRun>(`saved/${encodeURIComponent(id)}`);
    setSaved({ id, run: data });
    setSnapshot(undefined);
    setStage(
      data.failure?.stage ??
        data.needsReview?.[0] ??
        (data.plan ? 'plan' : 'types'),
    );
    setEditor(false);
    setPage('proof');
    location.hash = `saved/${id}`;
  }
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<Example[]>('examples'),
      api<{ defaults: Partial<RunInput>; runsDirectory: string }>('config'),
      api<RunSnapshot[]>('runs'),
    ])
      .then(([items, config, runs]) => {
        if (!cancelled) {
          setExamples(items);
          setRecoverableRun(runs[0]);
          const requestedExample = items.find(
            (item) =>
              item.name === new URLSearchParams(location.search).get('example'),
          );
          if (!requestedExample) setSelectedExample('');
          setInput((v) => ({
            ...v,
            ...Object.fromEntries(
              Object.entries(config.defaults).filter(
                ([, v]) => v !== undefined,
              ),
            ),
            ...(requestedExample
              ? {
                  description: requestedExample.description,
                  problemDescription: requestedExample.problemDescription,
                  domainName: requestedExample.name,
                  problemName: `${requestedExample.name.slice(0, 30)}-case`,
                }
              : {}),
          }));
          setRunsDirectory(config.runsDirectory);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    const hash = location.hash.slice(1);
    if (hash.startsWith('saved/')) void perform(() => openSaved(hash.slice(6)));
    if (hash.startsWith('run/'))
      void perform(async () => {
        const s = await api<RunSnapshot>(
          `runs/${encodeURIComponent(hash.slice(4))}`,
        );
        if (!cancelled) {
          setSnapshot(s);
          setPage('proof');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!snapshot?.id) return;
    let disposed = false;
    const events = new EventSource(`/api/runs/${snapshot.id}/events`);
    const applySnapshot = (next: RunSnapshot) => {
      if (disposed || next.id !== snapshot.id) return;
      setSnapshot((previous) =>
        previous?.id === next.id && next.sequence >= previous.sequence
          ? next
          : previous,
      );
    };
    events.onmessage = (e) => {
      if (disposed) return;
      setConnected(true);
      applySnapshot(JSON.parse(e.data) as RunSnapshot);
    };
    events.onerror = () => {
      if (disposed) return;
      setConnected(false);
      void api<RunSnapshot>(`runs/${snapshot.id}`)
        .then(applySnapshot)
        .catch((e) => {
          if (!disposed) {
            setError(e.message);
          }
        });
    };
    return () => {
      disposed = true;
      events.close();
    };
  }, [snapshot?.id]);
  useEffect(() => {
    if (gateId && gateStage) {
      setStage(gateStage);
      setEditor(false);
      setGateMode(undefined);
      setNote('');
      document
        .querySelector<HTMLElement>('.gate-summary')
        ?.focus({ preventScroll: true });
    }
  }, [gateId, gateStage]);
  useEffect(() => {
    if (snapshot?.state === 'finished' && hasPlan) {
      setStage('plan');
      setEditor(false);
    }
  }, [snapshot?.state, hasPlan]);
  useEffect(() => {
    setSelectedMark('');
    setSelectedLine(undefined);
    setEditor(false);
    setGateMode(undefined);
  }, [stage]);
  useEffect(() => {
    if (selectedLine === undefined || stage === 'plan') return;
    const target = selectedMark
      ? document.getElementById(`source-line-${selectedLine}`)
      : document.querySelector('.proof-mark.selected');
    target?.scrollIntoView({
      block: 'nearest',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  }, [selectedLine, selectedMark, stage]);
  async function start() {
    await perform(async () => {
      const s = await api<RunSnapshot>('runs', { input });
      setSnapshot(s);
      setSaved(undefined);
      setStage('types');
      setPage('proof');
      location.hash = `run/${s.id}`;
    });
  }
  async function decide(decision: StageDecision) {
    await perform(async () => {
      if (saved && stage !== 'plan') {
        if (decision.action === 'edit' || decision.action === 'accept') {
          const next = await api<Saved>(
            `saved/${saved.id}/${decision.action === 'edit' ? 'edit' : 'pass'}`,
            {
              stage,
              result: decision.action === 'edit' ? decision.result : undefined,
            },
          );
          setSaved(next);
          location.hash = `saved/${next.id}`;
          setEditor(false);
          setNotice(
            decision.action === 'edit'
              ? 'Saved a new revision. Review the marked stages.'
              : 'Stage passed in a new saved revision.',
          );
        } else if (decision.action === 'feedback') {
          const { correlationId: _correlation, ...savedInput } =
            saved.run.input;
          const s = await api<RunSnapshot>('runs', {
            input: { ...input, ...savedInput },
            savedId: saved.id,
            stage,
            feedback: decision.message,
          });
          setSnapshot(s);
          setSaved(undefined);
          location.hash = `run/${s.id}`;
        }
      } else if (snapshot && gate) {
        const s = await api<RunSnapshot>(`runs/${snapshot.id}/decisions`, {
          gateId: gate.id,
          decision,
        });
        setSnapshot((previous) =>
          previous && previous.sequence > s.sequence ? previous : s,
        );
      }
      setGateMode(undefined);
      setNote('');
    });
  }
  function pickMark(mark: Record<string, unknown>) {
    setSelectedMark(text(mark.name));
    setSelectedLine(sourceLines(mark, sentences)[0]);
  }
  function selectAction(name: string) {
    setSelectedMark(name);
    const action = allActions.find((a) => a.name === name);
    setSelectedLine(action ? sourceLines(action, sentences)[0] : undefined);
  }
  function exportRun() {
    if (!run) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(run, null, 2) + '\n'], {
        type: 'application/json',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${run.input.domainName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  async function showRack() {
    await perform(async () => {
      setRack(await api<SavedItem[]>('saved'));
      setPage('rack');
    });
  }
  function importFile(file?: File) {
    if (!file) return;
    void perform(async () => {
      const imported = await api<Saved>('saved', JSON.parse(await file.text()));
      await openSaved(imported.id);
    });
  }
  const usedLines = new Set(
    rows.flatMap((r) =>
      Object.values(obj(r.result)).flatMap((v) =>
        Array.isArray(v)
          ? v.flatMap((item) => sourceLines(obj(item), sentences))
          : [],
      ),
    ),
  );
  const title = run?.input.domainName ?? snapshot?.input.domainName;
  const proofInput = run?.input ?? snapshot?.input;

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to working sheet
      </a>
      <header className="masthead">
        <button
          className="wordmark"
          onClick={() => {
            setPage('new');
            setError('');
          }}
        >
          Galley Proof<span>A process, in proof.</span>
        </button>
        <nav aria-label="Workspace">
          <button
            className={page === 'new' ? 'nav-active' : ''}
            onClick={() => setPage('new')}
          >
            New proof
          </button>
          <button
            className={page === 'rack' ? 'nav-active' : ''}
            onClick={() => void showRack()}
          >
            Galley rack
          </button>
          {(snapshot || saved) && (
            <button
              className={page === 'proof' ? 'nav-active' : ''}
              onClick={() => setPage('proof')}
            >
              Current proof
            </button>
          )}
        </nav>
        <span className="local-label">Local workspace</span>
      </header>
      <div className="messages" aria-live="polite">
        {error && (
          <div className="error-banner" role="alert">
            <strong>Something needs attention.</strong> {error}
            <button className="quiet" onClick={() => setError('')}>
              Dismiss
            </button>
          </div>
        )}
        {notice && <p className="notice">{notice}</p>}
        {recoverableRun && recoverableRun.id !== snapshot?.id && (
          <p className="notice">
            An unfinished run is waiting: {recoverableRun.input.domainName}.{' '}
            <button
              onClick={() =>
                void perform(async () => {
                  const current = await api<RunSnapshot>(
                    `runs/${recoverableRun.id}`,
                  );
                  setSaved(undefined);
                  setSnapshot(current);
                  setPage('proof');
                  setRecoverableRun(undefined);
                  location.hash = `run/${current.id}`;
                })
              }
            >
              Resume current run
            </button>
          </p>
        )}
        {!connected && snapshot && (
          <p className="error-banner">
            Connection interrupted. Reconnecting to the local server; the run
            may still be working.
          </p>
        )}
      </div>
      {page === 'new' && (
        <main id="main-content" className="intake">
          <section className="intake-intro">
            <h1>
              Put your process
              <br />
              on the record.
            </h1>
            <p>
              Describe how the work happens. We’ll turn your words into a model
              you can check, correct, and put through its paces.
            </p>
            <div className="process-preview" aria-label="The six stages">
              {stages.map((s, i) => (
                <span key={s}>
                  <span className="line-no">
                    {String(i + 1).padStart(2, '0')}
                  </span>{' '}
                  {labels[s]}
                </span>
              ))}
            </div>
            <p className="small">
              You approve each stage. Keep your description beside the model, or
              hide it to make room while exploring the plan.
            </p>
            <label className="import-button">
              Open a saved proof
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => importFile(e.target.files?.[0])}
              />
            </label>
            <p className="small">
              Saved proofs can be inspected and edited without a daemon.
            </p>
          </section>
          <form
            className="intake-form"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <div className="section-title">
              <h2>A new proof</h2>
              <span className="sheet-label">Description + situation</span>
            </div>
            <label className="field">
              Start with an example
              <select
                value={selectedExample}
                onChange={(e) => {
                  setSelectedExample(e.target.value);
                  const example = examples.find(
                    (x) => x.name === e.target.value,
                  );
                  if (example)
                    setInput((v) => ({
                      ...v,
                      description: example.description,
                      problemDescription: example.problemDescription,
                      domainName: example.name,
                      problemName: `${example.name.slice(0, 30)}-case`,
                    }));
                }}
              >
                <option value="">Write your own, or choose an example</option>
                {examples.map((e) => (
                  <option key={e.name} value={e.name}>
                    {e.name.replaceAll('-', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              How does the process work?
              <textarea
                className="description-input"
                required
                rows={8}
                value={input.description}
                onChange={(e) => {
                  setSelectedExample('');
                  setInput({ ...input, description: e.target.value });
                }}
                placeholder="Describe who takes part, what each step needs, and what changes after it."
              />
            </label>
            <label className="field">
              What situation should the plan solve?
              <textarea
                required
                rows={4}
                value={input.problemDescription}
                onChange={(e) => {
                  setSelectedExample('');
                  setInput({ ...input, problemDescription: e.target.value });
                }}
                placeholder="Name the things involved, what is true at the start, and the goal."
              />
            </label>
            <div className="two-fields">
              <label className="field">
                Model name
                <input
                  required
                  pattern="[a-z][a-z0-9-]{0,39}"
                  value={input.domainName}
                  onChange={(e) =>
                    setInput({ ...input, domainName: e.target.value })
                  }
                />
              </label>
              <label className="field">
                Situation name
                <input
                  required
                  pattern="[a-z][a-z0-9-]{0,39}"
                  value={input.problemName}
                  onChange={(e) =>
                    setInput({ ...input, problemName: e.target.value })
                  }
                />
              </label>
            </div>
            <details
              className="connection"
              open={!input.teamId || !input.diaryId || !input.profileId}
            >
              <summary>MoltNet connection</summary>
              <p className="small">
                Use your configured agent and running daemon. Credentials stay
                on this machine’s server.
              </p>
              {(['teamId', 'diaryId', 'profileId'] as const).map((k) => (
                <label className="field" key={k}>
                  {k === 'teamId'
                    ? 'Team ID'
                    : k === 'diaryId'
                      ? 'Diary ID'
                      : 'Default generation profile name or ID'}
                  <input
                    required
                    aria-describedby={
                      k === 'profileId' ? 'profile-help' : undefined
                    }
                    value={input[k]}
                    onChange={(e) =>
                      setInput({ ...input, [k]: e.target.value })
                    }
                  />
                </label>
              ))}
              <ProfileGuidance input={input} onChange={setInput} />
            </details>
            <div className="intake-submit">
              <button className="primary" disabled={busy || active}>
                {busy ? 'Starting…' : 'Begin proof'}
              </button>
              <span className="small">
                {active
                  ? 'A proof is already active. Return to its review gate.'
                  : 'Generation needs your MoltNet daemon.'}
              </span>
            </div>
          </form>
        </main>
      )}
      {page === 'rack' && (
        <main id="main-content" className="rack">
          <div className="section-title">
            <div>
              <h1>Galley rack</h1>
              <p>Saved proofs, ready for another reading.</p>
            </div>
            <label className="import-button">
              Import proof
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => importFile(e.target.files?.[0])}
              />
            </label>
          </div>
          <p className="small storage-path">Stored in {runsDirectory}</p>
          {rack.length ? (
            <table>
              <thead>
                <tr>
                  <th>Proof</th>
                  <th>Last saved</th>
                  <th>Recorded result</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rack.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.name}
                      {item.error && <p>{item.error}</p>}
                    </td>
                    <td>
                      {item.updatedAt
                        ? new Date(item.updatedAt).toLocaleString()
                        : '—'}
                    </td>
                    <td>{item.status.replaceAll('_', ' ')}</td>
                    <td>
                      <button
                        disabled={busy || !!item.error}
                        onClick={() => void perform(() => openSaved(item.id))}
                      >
                        Open proof
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">
              <h2>Your first proof belongs here.</h2>
              <p>
                Finish a run and save it, or import a DesignRun JSON file.
                Opening and editing saved work does not need a daemon.
              </p>
              <button onClick={() => setPage('new')}>Start a proof</button>
            </div>
          )}
        </main>
      )}
      {page === 'proof' && (
        <main
          id="main-content"
          className={`workspace ${stage === 'plan' ? 'plan-workspace' : ''}`}
        >
          <aside className="routing-slip" aria-label="Stage routing slip">
            <h2>Routing slip</h2>
            <ol ref={stageRail}>
              {stages.map((s, i) => {
                const state = stageState(s, snapshot, run);
                const r = latest(rows, s);
                const eventAt = snapshot?.events.findLast(
                  ({ event }) =>
                    'stage' in event &&
                    event.stage === s &&
                    event.type === 'task-created',
                )?.at;
                const running =
                  active &&
                  ['Task sent', 'Picked up', 'Correcting', 'Checking'].includes(
                    state,
                  );
                return (
                  <li key={s}>
                    <button
                      aria-current={stage === s ? 'step' : undefined}
                      onClick={() => setStage(s)}
                    >
                      <span className="step-title">
                        <span className="line-no">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        {labels[s]}
                      </span>
                      <span
                        className={
                          ['Passed', 'Checked'].includes(state)
                            ? 'stamp small-stamp'
                            : 'stage-status'
                        }
                      >
                        {state}
                      </span>
                      <span className="stage-metrics">
                        {r ? `Try ${r.attempt}` : '—'}
                        <span>
                          {running && eventAt
                            ? `${Math.floor((clock - eventAt) / 1000)}s`
                            : r
                              ? `${Math.round(r.durationMs / 1000)}s`
                              : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="small">
              {saved
                ? 'Saved proof. Local checks are available.'
                : 'The slip follows the workflow as it happens.'}
            </p>
          </aside>
          <div className="proof-sheet">
            <div className="proof-heading">
              <div>
                <h1>{title?.replaceAll('-', ' ') || 'Working proof'}</h1>
                <p>
                  {saved
                    ? 'Reopened locally'
                    : snapshot?.state === 'awaiting'
                      ? 'Ready for your reading'
                      : snapshot?.state === 'finished'
                        ? 'Run finished'
                        : snapshot?.state === 'failed'
                          ? 'Run stopped'
                          : 'Work in progress'}
                  {run?.needsReview?.length ? ' · edits need review' : ''}
                </p>
                {correlationId && (
                  <details className="run-details">
                    <summary>Run details</summary>
                    <p>
                      Correlation ID · shared by this run’s stage tasks and
                      retries.
                    </p>
                    <div className="run-correlation">
                      <code>{correlationId}</code>
                      <button
                        type="button"
                        onClick={() =>
                          void perform(async () => {
                            await navigator.clipboard.writeText(correlationId);
                            setNotice('Correlation ID copied.');
                          })
                        }
                      >
                        Copy correlation ID
                      </button>
                    </div>
                  </details>
                )}
              </div>
              <div className="proof-tools">
                <button
                  aria-expanded={descriptionVisible}
                  aria-controls="description-column"
                  onClick={() =>
                    stage === 'plan'
                      ? setShowPlanDescription(!showPlanDescription)
                      : setShowDescription(!showDescription)
                  }
                >
                  {descriptionVisible ? 'Hide description' : 'Show description'}
                </button>
                <button
                  aria-expanded={construction}
                  aria-controls="construction-column"
                  onClick={() => setConstruction(!construction)}
                >
                  {construction ? 'Hide construction' : 'Show construction'}
                </button>
                <button
                  disabled={busy || !run}
                  onClick={() =>
                    void perform(async () => {
                      if (saved) {
                        setNotice('This revision is already saved.');
                        return;
                      }
                      if (snapshot) {
                        const value = await api<{ id: string }>(
                          `runs/${snapshot.id}/save`,
                          {},
                        );
                        setNotice(
                          `Proof saved. You can reopen it from the galley rack.`,
                        );
                        location.hash = `saved/${value.id}`;
                      }
                    })
                  }
                >
                  Save proof
                </button>
                <button disabled={!run} onClick={exportRun}>
                  Export JSON
                </button>
              </div>
            </div>
            {snapshot?.state === 'running' && (
              <details className="finding warning">
                <summary>Withdraw running proof</summary>
                <p>
                  Stop this workflow and release it for a new proof. A task
                  already sent to a generation worker may still finish.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const reason = new FormData(event.currentTarget).get(
                      'reason',
                    );
                    void perform(async () => {
                      const next = await api<RunSnapshot>(
                        `runs/${snapshot.id}/withdraw`,
                        { reason },
                      );
                      setSnapshot(next);
                      setRecoverableRun(undefined);
                    });
                  }}
                >
                  <label>
                    Reason for withdrawal
                    <input name="reason" required maxLength={10000} />
                  </label>
                  <button disabled={busy} type="submit">
                    Withdraw proof
                  </button>
                </form>
              </details>
            )}
            {run?.failure?.code === 'claim-timeout' ? (
              <section
                className="finding warning"
                role="status"
                aria-label="Worker timeout"
              >
                <h2>No worker picked up this step</h2>
                <p>
                  The {labels[run.failure.stage]} task was not claimed before
                  the waiting limit. Start a daemon worker for the selected
                  profile and team, then retry from New proof.
                </p>
                <p>
                  Check that the worker serves freeform tasks and that its
                  correlation filters allow this run.
                </p>
                <details>
                  <summary>Task details</summary>
                  <p>{run.failure.reason}</p>
                </details>
                <button
                  onClick={() => {
                    const { correlationId: _correlation, ...retryInput } =
                      snapshot?.input ?? run.input;
                    setInput((previous) => ({ ...previous, ...retryInput }));
                    setPage('new');
                  }}
                >
                  Review setup and retry
                </button>
              </section>
            ) : (
              (snapshot?.error || run?.failure) && (
                <div className="error-banner" role="alert">
                  {snapshot?.error ?? run?.failure?.reason}
                </div>
              )
            )}
            <div
              className={`proof-columns ${descriptionVisible ? 'with-description' : 'without-description'} ${construction ? 'with-construction' : ''}`}
            >
              {descriptionVisible && (
                <section
                  id="description-column"
                  className="galley"
                  aria-label="Source description"
                >
                  <div className="column-heading">
                    <h2>Your description</h2>
                    <span>{sentences.length} lines</span>
                  </div>
                  <ol className="sentences">
                    {sentences.map((sentence) => (
                      <li
                        key={sentence.line}
                        id={`source-line-${sentence.line}`}
                        className={
                          selectedLine === sentence.line ? 'selected' : ''
                        }
                      >
                        <button
                          onClick={() => {
                            setSelectedLine(sentence.line);
                            setSelectedMark('');
                          }}
                          aria-pressed={selectedLine === sentence.line}
                        >
                          <span className="line-no">
                            {String(sentence.line).padStart(2, '0')}
                          </span>
                          <span>
                            {sentence.text}
                            {rows.length > 0 &&
                              !usedLines.has(sentence.line) && (
                                <span className="unused">
                                  No recorded model link
                                </span>
                              )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                  <details className="situation">
                    <summary>The situation</summary>
                    <p>{proofInput?.problemDescription}</p>
                  </details>
                </section>
              )}
              <section className="margin" aria-label="Model proof marks">
                <div className="column-heading">
                  <h2>{labels[stage]}</h2>
                  <span>
                    {stage === 'plan'
                      ? 'Final proof'
                      : `${stages.indexOf(stage) + 1} / 5`}
                  </span>
                </div>
                <p className="stage-explanation">{explain[stage]}</p>
                {stage === 'actions' && !editor && record && (
                  <h3 className="actions-review-heading">
                    1. Read the draft actions
                  </h3>
                )}
                {!editor && (
                  <details
                    key={stage}
                    open={stage !== 'plan'}
                    className="stage-reading-guide"
                    aria-label={`${labels[stage]} reading guide`}
                  >
                    <summary>How to read {labels[stage].toLowerCase()}</summary>
                    {readingGuide[stage].map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                    {stage === 'predicates' && !allActions.length && (
                      <p>
                        Action references will appear after the Actions step.
                      </p>
                    )}
                  </details>
                )}

                {stage === 'plan' ? (
                  run?.domain && run?.problem ? (
                    <PlanExplorer
                      key={`${saved?.id ?? snapshot?.id}-${run.durationMs}`}
                      run={run}
                      onAction={selectAction}
                    />
                  ) : (
                    <div className="empty">
                      <h3>The plan comes after the model.</h3>
                      <p>
                        Pass each stage, then inspect the planner’s result here.
                      </p>
                    </div>
                  )
                ) : (
                  <>
                    {stageFindings.length > 0 && (
                      <section className="findings" aria-label="Check findings">
                        <h4>Local model checks</h4>
                        {stageFindings.map((finding, i) => (
                          <CheckFinding key={i} finding={finding} />
                        ))}
                      </section>
                    )}
                    {editor ? (
                      <StageEditor
                        key={`${stage}-${record?.attempt}`}
                        stage={stage}
                        result={
                          isGate
                            ? gate.result
                            : (record?.result ?? emptyStage(stage))
                        }
                        busy={busy}
                        onSubmit={(value) =>
                          void decide({ action: 'edit', result: value })
                        }
                        onCancel={() => setEditor(false)}
                      />
                    ) : (
                      <>
                        {!record && (
                          <div className="empty">
                            <h3>
                              {stageState(stage, snapshot, run) === 'Waiting'
                                ? 'This stage is still on the slip.'
                                : 'Waiting for the stage result.'}
                            </h3>
                            <p>
                              {active
                                ? 'The daemon’s result will appear here when it arrives.'
                                : 'No result is available for this stage.'}
                            </p>
                          </div>
                        )}
                        {marks.map((raw, i) => {
                          const mark = obj(raw);
                          const links = sourceLines(mark, sentences);
                          const name =
                            text(mark.name) || `Unnamed item ${i + 1}`;
                          const selected =
                            selectedMark === name ||
                            (selectedLine !== undefined &&
                              links.includes(selectedLine));
                          return (
                            <article
                              key={i}
                              className={`proof-mark ${['actions', 'refine'].includes(stage) ? 'action-proof-mark' : ''} ${selected ? 'selected' : ''}`}
                            >
                              <button
                                className="mark-heading"
                                onClick={() => pickMark(mark)}
                                aria-pressed={selected}
                              >
                                <span>{name.replaceAll('-', ' ')}</span>
                                <span className="source-ref">
                                  {links.length
                                    ? links
                                        .map(
                                          (l) =>
                                            `L${String(l).padStart(2, '0')}`,
                                        )
                                        .join(' · ')
                                    : 'Unlinked'}
                                </span>
                              </button>
                              {stage === 'predicates' && (
                                <FactDefinition
                                  name={name}
                                  description={text(mark.description)}
                                  parameters={mark.parameters}
                                />
                              )}
                              {stage !== 'predicates' &&
                                text(mark.description) && (
                                  <p>{text(mark.description)}</p>
                                )}
                              {text(mark.parent) && (
                                <p className="small">
                                  A kind of{' '}
                                  {text(mark.parent).replaceAll('-', ' ')}
                                </p>
                              )}
                              {stage !== 'predicates' &&
                                Array.isArray(mark.parameters) &&
                                mark.parameters.length > 0 && (
                                  <p className="small">
                                    {mark.parameters
                                      .map((p) => {
                                        const v = obj(p);
                                        return `${text(v.name)}: ${text(v.type)}`;
                                      })
                                      .join(' · ')}
                                  </p>
                                )}
                              {['actions', 'refine'].includes(stage) && (
                                <dl
                                  className="action-facts"
                                  tabIndex={0}
                                  aria-label={`${name.replaceAll('-', ' ')} action rules`}
                                >
                                  {(
                                    [
                                      [
                                        'preconditions',
                                        'Before',
                                        'No facts required',
                                      ],
                                      ['addEffects', 'Add', 'No facts added'],
                                      [
                                        'deleteEffects',
                                        'Remove',
                                        'No facts removed',
                                      ],
                                    ] as const
                                  ).map(([field, label, empty]) => (
                                    <div key={field}>
                                      <dt>{label}</dt>
                                      <dd>
                                        {atoms(mark[field]).length ? (
                                          <ul>
                                            {atoms(mark[field]).map(
                                              (atom, index) => (
                                                <li key={index}>
                                                  {fact(atom)}
                                                </li>
                                              ),
                                            )}
                                          </ul>
                                        ) : (
                                          empty
                                        )}
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                              )}
                              {selected &&
                                stage === 'predicates' &&
                                allActions.length > 0 && (
                                  <div className="cross-reference">
                                    <h4>Where this fact is used</h4>
                                    {(
                                      [
                                        'preconditions',
                                        'addEffects',
                                        'deleteEffects',
                                      ] as const
                                    ).map((k) => {
                                      const related = allActions.filter((a) =>
                                        atoms(a[k]).some(
                                          (p) => p.predicate === mark.name,
                                        ),
                                      );
                                      return (
                                        <div key={k}>
                                          <strong>
                                            {k === 'preconditions'
                                              ? 'Needed by'
                                              : k === 'addEffects'
                                                ? 'Added by'
                                                : 'Removed by'}
                                          </strong>
                                          {related.length ? (
                                            related.map((a) => (
                                              <button
                                                className="quiet"
                                                key={a.name}
                                                onClick={() => {
                                                  setStage(
                                                    latest(rows, 'refine')
                                                      ? 'refine'
                                                      : 'actions',
                                                  );
                                                  setTimeout(
                                                    () => selectAction(a.name),
                                                    0,
                                                  );
                                                }}
                                              >
                                                {a.name.replaceAll('-', ' ')} ·{' '}
                                                {sourceLines(a, sentences)
                                                  .map((l) => `L${l}`)
                                                  .join(', ') || 'unlinked'}
                                              </button>
                                            ))
                                          ) : (
                                            <span>No action</span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              {(findings.some((finding) =>
                                ownsFinding(name, finding),
                              ) ||
                                (['actions', 'refine'].includes(stage) &&
                                  !Array.isArray(mark.sourceLines))) && (
                                <details
                                  className="action-local-checks"
                                  open={findings.some(
                                    (finding) =>
                                      ownsFinding(name, finding) &&
                                      finding.severity === 'error',
                                  )}
                                >
                                  <summary>
                                    Local checks for {name.replaceAll('-', ' ')}
                                  </summary>
                                  {findings
                                    .filter((finding) =>
                                      ownsFinding(name, finding),
                                    )
                                    .map((finding, i) => (
                                      <CheckFinding key={i} finding={finding} />
                                    ))}
                                  {['actions', 'refine'].includes(stage) &&
                                    !Array.isArray(mark.sourceLines) && (
                                      <details className="finding warning">
                                        <summary>
                                          Source references missing
                                        </summary>
                                        <p>
                                          This result omitted the requested
                                          source line references. Check the
                                          quote against your description, then
                                          use Correct to add verified references
                                          or Return with note to request them.
                                        </p>
                                        {text(mark.source) && (
                                          <>
                                            <p className="small">
                                              Quote supplied in the result
                                            </p>
                                            <blockquote>
                                              {text(mark.source)}
                                            </blockquote>
                                          </>
                                        )}
                                      </details>
                                    )}
                                </details>
                              )}
                            </article>
                          );
                        })}
                        {stage === 'problem' && record && (
                          <div className="situation-result">
                            <h3>Objects in this situation</h3>
                            <ul className="plain-list">
                              {(Array.isArray(result.objects)
                                ? result.objects
                                : []
                              ).map((o, i) => (
                                <li key={i}>
                                  {text(obj(o).name)}{' '}
                                  <span className="small">
                                    · {text(obj(o).type)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            <h3>At the start</h3>
                            <ul className="plain-list">
                              {atoms(result.init).map((a, i) => (
                                <li key={i}>{fact(a)}</li>
                              ))}
                            </ul>
                            <h3>The goal</h3>
                            <ul className="plain-list">
                              {atoms(result.goal).map((a, i) => (
                                <li key={i}>{fact(a)}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {stage === 'refine' &&
                          Array.isArray(result.changes) && (
                            <details>
                              <summary>What changed in refinement</summary>
                              <ul>
                                {result.changes.map((c, i) => (
                                  <li key={i}>{text(c)}</li>
                                ))}
                              </ul>
                            </details>
                          )}
                      </>
                    )}
                  </>
                )}
                {stage === 'actions' && canPass && !editor && (
                  <SourceCheck
                    key={gate?.id ?? `saved-${record?.attempt}`}
                    domain={{
                      name: input.domainName,
                      types: (obj(latest(rows, 'types')?.result).types ??
                        []) as import('@pddl/domain/ir').TypeDef[],
                      predicates: (obj(latest(rows, 'predicates')?.result)
                        .predicates ??
                        []) as import('@pddl/domain/ir').PredicateDef[],
                      actions: (result.actions ?? []) as ActionDef[],
                    }}
                    runId={snapshot?.id}
                    gateId={isGate ? gate?.id : undefined}
                    attempt={record!.attempt}
                    record={
                      snapshot?.sourceCheck ??
                      run?.sourceChecks?.findLast(
                        (r) => r.attempt === record?.attempt,
                      )
                    }
                    onSnapshot={(next) =>
                      setSnapshot((previous) =>
                        previous && previous.sequence > next.sequence
                          ? previous
                          : next,
                      )
                    }
                    onNote={(message) => {
                      setGateMode('note');
                      setNote(message);
                    }}
                  />
                )}
              </section>
              {construction && (
                <aside
                  id="construction-column"
                  className="construction construction-column"
                  aria-label="Construction"
                  tabIndex={0}
                >
                  <h2>Construction</h2>
                  <p className="small">
                    Typed results and PDDL for the current proof.
                  </p>
                  <h3>
                    {stage === 'plan'
                      ? 'Plan result JSON'
                      : 'Typed result JSON'}
                  </h3>
                  <CodeBlock
                    language="json"
                    label={
                      stage === 'plan'
                        ? 'Plan result JSON'
                        : 'Typed result JSON'
                    }
                    code={
                      JSON.stringify(
                        stage === 'plan' ? run?.plan : record?.result,
                        null,
                        2,
                      ) ?? ''
                    }
                  />
                  {run?.domainPddl && (
                    <>
                      <h3>Domain PDDL</h3>
                      <CodeBlock
                        language="pddl"
                        label="Domain PDDL"
                        code={run.domainPddl}
                      />
                      <h3>Problem PDDL</h3>
                      <CodeBlock
                        language="pddl"
                        label="Problem PDDL"
                        code={run.problemPddl ?? ''}
                      />
                    </>
                  )}
                </aside>
              )}
            </div>
            {editable && !editor && (
              <footer className="gate-bar">
                <div className="gate-summary" tabIndex={-1}>
                  <strong>
                    {isGate
                      ? stage === 'actions'
                        ? '3. Pass or correct Actions'
                        : 'Your reading is needed'
                      : run?.needsReview?.includes(stage as StageName)
                        ? 'Review this revision'
                        : 'Saved proof · local editing'}
                  </strong>
                  <span>
                    {canPass
                      ? stage === 'actions'
                        ? 'Pass continues to Refinement. Correct edits the draft; Return with note requests a revision.'
                        : 'Read the marks against your description.'
                      : record
                        ? 'Correct the errors before passing.'
                        : 'Add a result to continue.'}
                  </span>
                </div>
                <div className="button-row">
                  <button
                    className="primary"
                    disabled={busy || sourceChecking || !canPass}
                    onClick={() => void decide({ action: 'accept' })}
                  >
                    Pass
                  </button>
                  <button
                    disabled={busy || sourceChecking}
                    onClick={() => setEditor(true)}
                  >
                    Correct
                  </button>
                  <button
                    disabled={busy || sourceChecking}
                    onClick={() => {
                      setGateMode('note');
                      setNote('');
                    }}
                  >
                    Return with note
                  </button>
                  {!saved && (
                    <button
                      className="quiet danger"
                      disabled={busy}
                      onClick={() => {
                        setGateMode('withdraw');
                        setNote('');
                      }}
                    >
                      Withdraw
                    </button>
                  )}
                </div>
                {gateMode && (
                  <form
                    className="gate-note"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void decide(
                        gateMode === 'note'
                          ? { action: 'feedback', message: note }
                          : { action: 'abort', reason: note },
                      );
                    }}
                  >
                    <label className="field">
                      {gateMode === 'note'
                        ? 'What should be corrected?'
                        : 'Why are you withdrawing this proof?'}
                      <textarea
                        required
                        autoFocus
                        rows={3}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </label>
                    {saved && gateMode === 'note' && (
                      <>
                        <p className="small">
                          A correction starts a new run and needs a daemon. Use
                          the configured connection below.
                        </p>
                        {(['teamId', 'diaryId', 'profileId'] as const).map(
                          (k) => (
                            <label key={k} className="field">
                              {k === 'teamId'
                                ? 'Team ID'
                                : k === 'diaryId'
                                  ? 'Diary ID'
                                  : 'Default generation profile name or ID'}
                              <input
                                required
                                aria-describedby={
                                  k === 'profileId' ? 'profile-help' : undefined
                                }
                                value={input[k]}
                                onChange={(e) =>
                                  setInput({ ...input, [k]: e.target.value })
                                }
                              />
                            </label>
                          ),
                        )}
                        <ProfileGuidance input={input} onChange={setInput} />
                      </>
                    )}
                    <div className="button-row">
                      <button
                        className="primary"
                        disabled={busy || !note.trim()}
                      >
                        {gateMode === 'note'
                          ? 'Send correction note'
                          : 'Withdraw proof'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setGateMode(undefined)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </footer>
            )}
          </div>
        </main>
      )}
      <footer className="site-footer">
        <span>Galley Proof</span>
        <span>Read. Correct. Check again.</span>
        <span>PDDL designer · experimental</span>
      </footer>
    </>
  );
}
