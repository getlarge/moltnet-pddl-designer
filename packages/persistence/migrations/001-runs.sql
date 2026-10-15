-- Application projections and decisions live beside Absurd, in the same database.
CREATE TABLE IF NOT EXISTS pddl_runs (
  id uuid PRIMARY KEY,
  queue text NOT NULL,
  task_id uuid NOT NULL,
  snapshot jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pddl_one_active_run_per_queue
  ON pddl_runs (queue)
  WHERE snapshot->>'state' IN ('running', 'awaiting');
CREATE TABLE IF NOT EXISTS pddl_run_events (
  run_id uuid NOT NULL REFERENCES pddl_runs(id),
  ordinal integer NOT NULL,
  PRIMARY KEY (run_id, ordinal)
);
CREATE TABLE IF NOT EXISTS pddl_run_gates (
  run_id uuid NOT NULL REFERENCES pddl_runs(id),
  gate_id text NOT NULL,
  decision jsonb,
  PRIMARY KEY (run_id, gate_id)
);
