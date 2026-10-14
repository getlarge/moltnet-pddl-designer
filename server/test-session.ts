import { randomUUID } from 'node:crypto';
import { hasErrors } from '../src/check.js';
import type { DesignInput } from '../src/stages.js';
import { type DesignOptions, type StageDecision } from '../src/workflow.js';
import type { RunSnapshot } from './types.js';

import type { Execute } from './run-service.js';

/** In-memory review gates for test fixtures only. */
export class Session {
  snapshot: RunSnapshot;
  private pending?: (decision: StageDecision) => void;
  private listeners = new Set<(snapshot: RunSnapshot) => void>();
  constructor(
    input: DesignInput,
    private execute: Execute,
    private options: DesignOptions = {},
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
    for (const notify of this.listeners) notify(this.snapshot);
  }
  subscribe(notify: (snapshot: RunSnapshot) => void) {
    this.listeners.add(notify);
    notify(this.snapshot);
    return () => this.listeners.delete(notify);
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
            this.pending = resolve;
            this.snapshot.gate = { ...gate, id: randomUUID() };
            this.snapshot.state = 'awaiting';
            this.publish();
          }),
      });
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
  decide(gateId: string, decision: StageDecision) {
    const gate = this.snapshot.gate;
    if (!gate || gate.id !== gateId || !this.pending)
      throw new Error(
        'This review has already changed. Refresh it before deciding.',
      );
    if (decision.action === 'accept' && hasErrors(gate.issues))
      throw new Error('Correct the errors before passing this stage.');
    const resolve = this.pending;
    this.pending = undefined;
    delete this.snapshot.gate;
    this.snapshot.state = 'running';
    this.publish();
    resolve(decision);
  }
}
