import { useState } from 'react';
import type { StageName } from '../src/stages.js';

type Row = Record<string, unknown>;
const captions: Record<string, string> = {
  name: 'Name',
  parent: 'Parent type (optional)',
  description: 'Meaning',
  parameters: 'Who or what takes part',
  type: 'Type',
  source: 'Source sentence',
  sourceLines: 'Source line numbers',
  preconditions: 'Before · needed facts',
  addEffects: 'After · facts added',
  deleteEffects: 'After · facts removed',
  args: 'Objects or parameters',
  predicate: 'Fact',
  negated: 'Must be false',
  init: 'Starting facts',
  goal: 'Goal facts',
  objects: 'Objects',
  changes: 'Refinement notes',
  types: 'Types',
  predicates: 'Facts',
  actions: 'Actions',
};
function template(key: string): unknown {
  switch (key) {
    case 'types':
      return { name: '', description: '', sourceLines: [] };
    case 'predicates':
      return { name: '', description: '', parameters: [], sourceLines: [] };
    case 'actions':
      return {
        name: '',
        parameters: [],
        preconditions: [],
        addEffects: [],
        deleteEffects: [],
        source: '',
        sourceLines: [],
      };
    case 'parameters':
      return { name: '?', type: '' };
    case 'objects':
      return { name: '', type: '' };
    case 'preconditions':
    case 'goal':
      return { predicate: '', args: [], negated: false };
    case 'init':
    case 'addEffects':
    case 'deleteEffects':
      return { predicate: '', args: [] };
    default:
      return '';
  }
}
export function emptyStage(stage: StageName): Row {
  switch (stage) {
    case 'types':
      return { types: [] };
    case 'predicates':
      return { predicates: [] };
    case 'actions':
      return { actions: [] };
    case 'refine':
      return { actions: [], changes: [] };
    case 'problem':
      return { objects: [], init: [], goal: [] };
  }
}
function normalize(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((v) => normalize(v, key));
  if (value && typeof value === 'object') {
    const row = { ...(value as Row) };
    if (['types', 'predicates', 'actions'].includes(key))
      row.sourceLines ??= [];
    if (key === 'types') row.parent ??= '';
    return Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, normalize(v, k)]),
    );
  }
  return value;
}
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k, v]) => k !== 'parent' || v !== '')
        .map(([k, v]) => [k, clean(v)]),
    );
  return value;
}
function CommaField({
  name,
  value,
  onChange,
  path,
}: {
  name: string;
  value: unknown;
  onChange: (v: unknown) => void;
  path: string;
}) {
  const [draft, setDraft] = useState(
    Array.isArray(value) ? value.join(', ') : String(value ?? ''),
  );
  return (
    <label className="field">
      {captions[name]}
      <input
        aria-label={`${path} ${captions[name]}`}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(
            e.target.value.trim()
              ? e.target.value
                  .split(',')
                  .map((s) =>
                    name === 'sourceLines' ? Number(s.trim()) : s.trim(),
                  )
              : [],
          );
        }}
        placeholder={
          name === 'sourceLines' ? 'e.g. 2, 3' : 'Separate with commas'
        }
      />
    </label>
  );
}
function Field({
  name,
  value,
  onChange,
  path,
}: {
  name: string;
  value: unknown;
  onChange: (v: unknown) => void;
  path: string;
}) {
  const caption = captions[name] ?? name;
  if (name === 'args' || name === 'sourceLines')
    return (
      <CommaField name={name} value={value} path={path} onChange={onChange} />
    );
  if (typeof value === 'boolean')
    return (
      <label className="check">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
        {caption}
      </label>
    );
  if (Array.isArray(value))
    return (
      <fieldset className="row-group">
        <legend>{caption}</legend>
        {value.map((row, i) => (
          <div className="edit-row" key={i}>
            <div className="row-heading">
              <span>
                {caption} {i + 1}
              </span>
              <button
                type="button"
                className="quiet danger"
                onClick={() => onChange(value.filter((_, n) => n !== i))}
              >
                Remove
              </button>
            </div>
            <Field
              name={name + '-row'}
              value={row}
              path={`${path} ${i + 1}`}
              onChange={(v) => onChange(value.map((r, n) => (n === i ? v : r)))}
            />
          </div>
        ))}
        <button
          type="button"
          className="quiet"
          onClick={() => onChange([...value, normalize(template(name), name)])}
        >
          Add {caption.toLowerCase()}
        </button>
      </fieldset>
    );
  if (value && typeof value === 'object')
    return (
      <div className="fields">
        {Object.entries(value).map(([key, v]) => (
          <Field
            key={key}
            name={key}
            path={`${path} ${key}`}
            value={v}
            onChange={(next) => onChange({ ...value, [key]: next })}
          />
        ))}
      </div>
    );
  if (typeof value !== 'string' && typeof value !== 'number')
    return (
      <p role="alert">
        This field is not editable as a row. Start a clean result below, or
        cancel to keep it unchanged.
      </p>
    );
  return (
    <label className="field">
      {caption.endsWith('-row') ? 'Text' : caption}
      {['description', 'source'].includes(name) ? (
        <textarea
          rows={2}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          value={String(value)}
          onChange={(e) =>
            onChange(
              typeof value === 'number'
                ? Number(e.target.value)
                : e.target.value,
            )
          }
        />
      )}
    </label>
  );
}
export function StageEditor({
  stage,
  result,
  busy,
  onSubmit,
  onCancel,
}: {
  stage: StageName;
  result: unknown;
  busy: boolean;
  onSubmit: (v: unknown) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => normalize(result));
  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(clean(draft));
      }}
    >
      <h3>Correct the {stage === 'predicates' ? 'facts' : stage}</h3>
      <p>
        Each change is checked before it can pass. Source numbers refer to the
        description beside this sheet.
      </p>
      <Field name={stage} value={draft} path={stage} onChange={setDraft} />
      <div className="button-row">
        <button className="primary" disabled={busy}>
          Check corrections
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="quiet"
          onClick={() => setDraft(emptyStage(stage))}
        >
          Start a clean result
        </button>
      </div>
    </form>
  );
}
