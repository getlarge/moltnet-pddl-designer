import { randomUUID } from 'node:crypto';
import {
  buildGroundingRequest,
  parseGroundingAnswers,
  type GroundingTarget,
} from '../src/source-grounding.js';
import type {
  Domain,
  TypesResult,
  PredicatesResult,
  ActionsResult,
} from '../src/ir.js';
import type { SourceAssessor, SourceCheckRecord } from '../src/source-check.js';
import { hasErrors } from '../src/check.js';
import type { DesignInput } from '../src/stages.js';
import { type DesignOptions, type StageDecision } from '../src/workflow.js';
import type { RunSnapshot } from './types.js';

import type { Execute } from './run-service.js';

/** In-memory review gates for test fixtures only. */
export class Session {
  snapshot: RunSnapshot;
  private pending?: (decision: StageDecision) => void;
  constructor(
    input: DesignInput,
    private execute: Execute,
    private options: DesignOptions = {},
    private assessor?: SourceAssessor,
  ) {
    this.snapshot = {
      id: randomUUID(),
      input,
      startedAt: Date.now(),
      sequence: 0,
      state: 'running',
      events: [],
    };
  }
  private publish() {
    this.snapshot.sequence++;
  }
  async start(input: DesignInput) {
    try {
      const run = await this.execute(input, {
        ...this.options,
        onEvent: (event) => {
          this.snapshot.events.push({ at: Date.now(), event });
          if (event.type === 'finished') this.snapshot.run = event.run;
          this.publish();
        },
        confirmStage: (gate) =>
          new Promise((resolve) => {
            if (
              gate.stage === 'actions' &&
              this.snapshot.sourceCheck?.attempt !== gate.attempt
            )
              delete this.snapshot.sourceCheck;
            this.pending = resolve;
            this.snapshot.gate = { ...gate, id: randomUUID() };
            this.snapshot.state = 'awaiting';
            this.publish();
          }),
      });
      if (this.snapshot.sourceCheck)
        run.sourceChecks = [this.snapshot.sourceCheck];
      this.snapshot.run = run;
      this.snapshot.state = 'finished';
    } catch (error) {
      this.snapshot.state = 'failed';
      this.snapshot.error =
        error instanceof Error ? error.message : String(error);
    } finally {
      this.pending = undefined;
      delete this.snapshot.gate;
      this.publish();
    }
  }
  previewSource(gateId: string, targets: GroundingTarget[]) {
    const gate = this.snapshot.gate;
    if (
      !gate ||
      gate.id !== gateId ||
      gate.stage !== 'actions' ||
      hasErrors(gate.issues)
    )
      throw new Error(
        'Choose the current valid Actions draft before checking its source.',
      );
    const rows = this.snapshot.events.flatMap(({ event }) =>
      event.type === 'stage-result' ? [event.record] : [],
    );
    const domain: Domain = {
      name: this.snapshot.input.domainName,
      types: (rows.findLast((r) => r.stage === 'types')!.result as TypesResult)
        .types,
      predicates: (
        rows.findLast((r) => r.stage === 'predicates')!
          .result as PredicatesResult
      ).predicates,
      actions: (gate.result as ActionsResult).actions,
    };
    return buildGroundingRequest(
      this.snapshot.input.description,
      domain,
      targets,
    );
  }
  async checkSource(
    gateId: string,
    targets: GroundingTarget[],
    profile: string,
  ) {
    if (!this.assessor) throw new Error('Source assessment is unavailable.');
    if (this.snapshot.sourceCheck?.status === 'checking')
      throw new Error('A source check is already running.');
    const input = this.previewSource(gateId, targets);
    const started = Date.now();
    const record: SourceCheckRecord = {
      attempt: this.snapshot.gate!.attempt,
      input,
      status: 'checking',
      durationMs: 0,
    };
    this.snapshot.sourceCheck = record;
    this.publish();
    try {
      const answer = await this.assessor(input, profile, (taskId) => {
        record.taskId = taskId;
        if (this.snapshot.gate?.id === gateId) this.publish();
      });
      parseGroundingAnswers(answer.output, input);
      if (this.snapshot.gate?.id === gateId)
        Object.assign(record, answer, { status: 'complete' });
    } catch (error) {
      record.status = 'failed';
      record.failure = error instanceof Error ? error.message : String(error);
    } finally {
      record.durationMs = Date.now() - started;
      if (this.snapshot.gate?.id === gateId) this.publish();
    }
    return this.snapshot;
  }

  decide(gateId: string, decision: StageDecision) {
    const gate = this.snapshot.gate;
    if (!gate || gate.id !== gateId || !this.pending)
      throw new Error(
        'This review has already changed. Refresh it before deciding.',
      );
    if (decision.action === 'accept' && hasErrors(gate.issues))
      throw new Error('Correct the errors before passing this stage.');
    if (
      this.snapshot.sourceCheck?.status === 'checking' &&
      decision.action !== 'abort'
    )
      throw new Error('Wait for the source check, or withdraw this proof.');
    if (
      decision.action === 'abort' &&
      this.snapshot.sourceCheck?.status === 'checking'
    ) {
      this.snapshot.sourceCheck.status = 'failed';
      this.snapshot.sourceCheck.failure =
        'Proof withdrawn. The pending result will not be applied.';
    }
    if (decision.action === 'edit' || decision.action === 'feedback')
      delete this.snapshot.sourceCheck;
    const resolve = this.pending;
    this.pending = undefined;
    delete this.snapshot.gate;
    this.snapshot.state = 'running';
    this.publish();
    resolve(decision);
  }
}
