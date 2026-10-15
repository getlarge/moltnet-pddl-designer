import { randomUUID } from 'node:crypto';
import { Absurd, type JsonValue } from 'absurd-sdk';
import { Pool, type PoolClient } from 'pg';
import type { ClassifyInput } from '@themoltnet/sdk';
import { type GroundingTarget } from '@pddl/domain/source-grounding';
import type { SourceCheckRecord } from '@pddl/contracts/source-check';
import { previewSource } from './source-check.js';
import { hasErrors } from '@pddl/domain/check';
import type { DesignInput } from '@pddl/contracts/stages';
import type {
  DesignEvent,
  StageGate,
  StageDecision,
} from '@pddl/contracts/design';
import type { RunSnapshot } from '@pddl/contracts/api';
import {
  RunConflict,
  type RunOptions,
  type RunService,
} from './run-service.js';

export const DESIGN_QUEUE = 'pddl_designer_v1';
export const TASK_NAME = 'design.v1';
export const SOURCE_TASK = 'source-check.v1';
export interface SourceParams {
  id: string;
  gateId: string;
  request: ClassifyInput;
  profile: string;
  startedAt: number;
}
const active = (s: RunSnapshot) =>
  s.state === 'running' || s.state === 'awaiting';
interface RunRow {
  snapshot: RunSnapshot;
  task_id: string;
}
export interface Params {
  id: string;
  input: DesignInput;
  options: RunOptions;
}

/** Postgres is the source of truth. A process restart needs no in-memory session. */
export class DurableRuns implements RunService {
  readonly pool: Pool;
  readonly absurd: Absurd;
  readonly queue: string;
  constructor(options: { databaseUrl: string; queue?: string }) {
    this.queue = options.queue ?? DESIGN_QUEUE;
    this.pool = new Pool({ connectionString: options.databaseUrl });
    this.pool.on('error', (error) => {
      console.error(
        'Idle database connection failed; the pool will reconnect.',
        error,
      );
    });
    this.absurd = new Absurd({ db: this.pool, queueName: this.queue });
  }
  async updateSource(
    id: string,
    gateId: string,
    workflowId: string,
    patch: Partial<SourceCheckRecord>,
  ) {
    return this.transaction(async (db) => {
      const { snapshot } = await this.lock(db, id);
      if (
        snapshot.state === 'awaiting' &&
        snapshot.gate?.id === gateId &&
        snapshot.sourceCheck?.workflowId === workflowId &&
        snapshot.sourceCheck.status === 'checking'
      ) {
        Object.assign(snapshot.sourceCheck, patch);
        await this.save(db, snapshot);
      }
      return snapshot;
    });
  }
  async previewSource(id: string, gateId: string, targets: GroundingTarget[]) {
    const snapshot = await this.get(id);
    if (!snapshot) throw new RunConflict('This run does not exist.');
    return previewSource(snapshot, gateId, targets);
  }
  async checkSource(
    id: string,
    gateId: string,
    targets: GroundingTarget[],
    profile: string,
  ) {
    return this.transaction(async (db) => {
      const { snapshot } = await this.lock(db, id);
      if (snapshot.sourceCheck?.status === 'checking')
        throw new RunConflict('A source check is already running.');
      if (!profile.trim())
        throw new RunConflict('Choose a classification profile.');
      const request = previewSource(snapshot, gateId, targets);
      const task = await this.absurd.bindToConnection(db).spawn<SourceParams>(
        SOURCE_TASK,
        { id, gateId, request, profile, startedAt: Date.now() },
        {
          queue: this.queue,
          idempotencyKey: randomUUID(),
          maxAttempts: 5,
          retryStrategy: {
            kind: 'exponential',
            baseSeconds: 1,
            maxSeconds: 30,
          },
        },
      );
      snapshot.sourceCheck = {
        attempt: snapshot.gate!.attempt,
        input: request,
        status: 'checking',
        workflowId: task.taskID,
        durationMs: 0,
      };
      await this.save(db, snapshot);
      return snapshot;
    });
  }
  async initialize() {
    // Provisioning is explicit; never initialize/migrate an arbitrary database here.
    await this.pool.query('SELECT id FROM pddl_runs LIMIT 0');
    await this.absurd.createQueue(this.queue);
  }
  async startWorker(
    options: { claimTimeout?: number; pollInterval?: number } = {},
  ) {
    return this.absurd.startWorker({ concurrency: 1, ...options });
  }
  async close() {
    await this.absurd.close();
    await this.pool.end();
  }
  private async transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const result = await fn(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
  private async lock(db: PoolClient, id: string) {
    const { rows } = await db.query<RunRow>(
      'SELECT snapshot, task_id FROM pddl_runs WHERE id = $1 AND queue = $2 FOR UPDATE',
      [id, this.queue],
    );
    if (!rows[0]) throw new RunConflict('This run does not exist.');
    return rows[0];
  }
  private async save(db: PoolClient, snapshot: RunSnapshot) {
    snapshot.sequence++;
    await db.query(
      'UPDATE pddl_runs SET snapshot = $2 WHERE id = $1 AND queue = $3',
      [snapshot.id, JSON.stringify(snapshot), this.queue],
    );
  }
  async start(input: DesignInput, options: RunOptions) {
    // Reconcile terminal engine failures before enforcing the active-run limit.
    await this.list();
    return this.transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `pddl:${this.queue}`,
      ]);
      const { rowCount } = await db.query(
        "SELECT id FROM pddl_runs WHERE queue = $1 AND snapshot->>'state' IN ('running','awaiting')",
        [this.queue],
      );
      if (rowCount)
        throw new RunConflict(
          'Finish or withdraw the current run before starting another.',
        );
      const id = randomUUID();
      const snapshot: RunSnapshot = {
        id,
        input,
        startedAt: Date.now(),
        sequence: 0,
        state: 'running',
        events: [],
      };
      // The queue insertion and visible run commit together, closing the spawn gap.
      const task = await this.absurd.bindToConnection(db).spawn<Params>(
        TASK_NAME,
        { id, input, options },
        {
          queue: this.queue,
          idempotencyKey: id,
          maxAttempts: 5,
          retryStrategy: {
            kind: 'exponential',
            baseSeconds: 1,
            maxSeconds: 30,
          },
        },
      );
      await db.query(
        'INSERT INTO pddl_runs(id, queue, task_id, snapshot) VALUES ($1,$2,$3,$4)',
        [id, this.queue, task.taskID, JSON.stringify(snapshot)],
      );
      return snapshot;
    });
  }
  async get(id: string): Promise<RunSnapshot | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    const { rows } = await this.pool.query<RunRow>(
      'SELECT snapshot, task_id FROM pddl_runs WHERE id = $1 AND queue = $2',
      [id, this.queue],
    );
    if (!rows[0]) return undefined;
    const { snapshot, task_id: taskId } = rows[0];
    if (!active(snapshot)) return snapshot;
    if (
      snapshot.sourceCheck?.status === 'checking' &&
      snapshot.sourceCheck.workflowId &&
      snapshot.gate
    ) {
      const source = await this.absurd.fetchTaskResult(
        snapshot.sourceCheck.workflowId,
      );
      if (
        source?.state === 'failed' ||
        source?.state === 'cancelled' ||
        source?.state === 'completed'
      )
        return this.updateSource(
          id,
          snapshot.gate.id,
          snapshot.sourceCheck.workflowId,
          {
            status: 'failed',
            failure:
              'The source-check workflow ended without an answer. You can retry the check or review the draft.',
          },
        );
    }
    const result = await this.absurd.fetchTaskResult(taskId);
    if (result?.state === 'failed' || result?.state === 'cancelled') {
      return this.transaction(async (db) => {
        const row = await this.lock(db, id);
        if (active(row.snapshot)) {
          row.snapshot.state = 'failed';
          row.snapshot.error =
            result.state === 'cancelled'
              ? 'This run was withdrawn.'
              : 'The durable workflow exhausted its retries. Inspect the worker logs, then start a new run.';
          delete row.snapshot.gate;
          await this.save(db, row.snapshot);
        }
        return row.snapshot;
      });
    }
    return snapshot;
  }
  async list() {
    const { rows } = await this.pool.query<{ id: string }>(
      "SELECT id FROM pddl_runs WHERE queue = $1 AND snapshot->>'state' IN ('running','awaiting') ORDER BY snapshot->>'startedAt'",
      [this.queue],
    );
    const snapshots = await Promise.all(rows.map(({ id }) => this.get(id)));
    return snapshots.filter((s): s is RunSnapshot => !!s && active(s));
  }
  async publish(id: string, ordinal: number, event: DesignEvent) {
    await this.transaction(async (db) => {
      const { snapshot } = await this.lock(db, id);
      if (!active(snapshot)) return;
      const inserted = await db.query(
        'INSERT INTO pddl_run_events(run_id, ordinal) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING ordinal',
        [id, ordinal],
      );
      if (!inserted.rowCount) return; // Replay must not duplicate history or rewind UI state.
      if (event.type === 'finished' && snapshot.sourceCheck)
        event = {
          ...event,
          run: {
            ...event.run,
            sourceChecks: [structuredClone(snapshot.sourceCheck)],
          },
        };
      snapshot.events.push({ at: Date.now(), event });
      if (event.type === 'finished') {
        snapshot.run = event.run;
        snapshot.state = 'finished';
        delete snapshot.gate;
      }
      await this.save(db, snapshot);
    });
  }
  async publishGate(id: string, ordinal: number, gate: StageGate) {
    const gateId = `${id}:${ordinal}`;
    return this.transaction(async (db) => {
      const { snapshot } = await this.lock(db, id);
      const result = await db.query(
        'INSERT INTO pddl_run_gates(run_id,gate_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING gate_id',
        [id, gateId],
      );
      if (!result.rowCount || !active(snapshot)) return;
      if (
        gate.stage === 'actions' &&
        snapshot.sourceCheck?.attempt !== gate.attempt
      )
        delete snapshot.sourceCheck;
      snapshot.gate = { ...gate, id: gateId };
      snapshot.state = 'awaiting';
      await this.save(db, snapshot);
    });
  }
  async decide(id: string, gateId: string, decision: StageDecision) {
    return this.transaction(async (db) => {
      const { snapshot } = await this.lock(db, id);
      if (snapshot.state !== 'awaiting' || snapshot.gate?.id !== gateId)
        throw new RunConflict(
          'This review has already changed. Refresh it before deciding.',
        );
      if (decision.action === 'accept' && hasErrors(snapshot.gate.issues))
        throw new RunConflict('Correct the errors before passing this stage.');
      if (snapshot.sourceCheck?.status === 'checking') {
        if (decision.action !== 'abort')
          throw new RunConflict(
            'Wait for the source check, or withdraw this proof.',
          );
        await this.cancelSource(db, snapshot);
      }
      if (decision.action === 'edit' || decision.action === 'feedback')
        delete snapshot.sourceCheck;
      await db.query(
        'UPDATE pddl_run_gates SET decision = $3 WHERE run_id = $1 AND gate_id = $2',
        [id, gateId, JSON.stringify(decision)],
      );
      await this.absurd
        .bindToConnection(db)
        .emitEvent(`decision:${gateId}`, decision as JsonValue);
      delete snapshot.gate;
      snapshot.state = 'running';
      await this.save(db, snapshot);
      return snapshot;
    });
  }
  private async cancelSource(db: PoolClient, snapshot: RunSnapshot) {
    if (snapshot.sourceCheck?.status !== 'checking') return;
    if (snapshot.sourceCheck.workflowId)
      await this.absurd
        .bindToConnection(db)
        .cancelTask(snapshot.sourceCheck.workflowId);
    snapshot.sourceCheck.status = 'failed';
    snapshot.sourceCheck.failure =
      'Proof withdrawn. The pending result will not be applied.';
  }
  async withdraw(id: string, reason: string) {
    return this.transaction(async (db) => {
      const { snapshot, task_id: taskId } = await this.lock(db, id);
      if (!active(snapshot))
        throw new RunConflict('This run has already ended.');
      await this.cancelSource(db, snapshot);
      await this.absurd.bindToConnection(db).cancelTask(taskId);
      delete snapshot.gate;
      snapshot.state = 'failed';
      snapshot.error = `Withdrawn: ${reason}`;
      await this.save(db, snapshot);
      return snapshot;
    });
  }
}
