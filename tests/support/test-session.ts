import type { DesignOptions } from '@pddl/workflows/workflow';
import { previewSource } from '@pddl/persistence/source-check';
import { randomUUID } from 'node:crypto';
import {
  parseGroundingAnswers,
  type GroundingTarget,
} from '@pddl/domain/source-grounding';
import type { SourceAssessor, SourceCheckRecord } from '@pddl/contracts/source-check';
import { hasErrors } from '@pddl/domain/check';
import type { DesignInput } from '@pddl/contracts/stages';
import { type StageDecision } from '@pddl/contracts/design';
import type { RunSnapshot } from '@pddl/contracts/api';

import type { Execute } from '@pddl/workflows/executor';

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
    return previewSource(this.snapshot, gateId, targets);
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
