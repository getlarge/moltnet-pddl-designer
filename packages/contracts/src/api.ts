import type { SourceCheckRecord } from './source-check.js';
import type { DesignEvent, DesignRun, StageGate } from './design.js';
import type { DesignInput, StageName } from './stages.js';
export type RunInput = Omit<DesignInput, 'correlationId'>;
export interface Gate extends StageGate {
  id: string;
}
export interface RunSnapshot {
  id: string;
  input: DesignInput;
  startedAt: number;
  sequence: number;
  state: 'running' | 'awaiting' | 'finished' | 'failed' | 'offline';
  events: Array<{ at: number; event: DesignEvent }>;
  gate?: Gate;
  run?: DesignRun;
  error?: string;
  sourceCheck?: SourceCheckRecord;
}
export interface SavedItem {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
  error?: string;
}
export interface StartRequest {
  input: RunInput;
  savedId?: string;
  stage?: StageName;
  feedback?: string;
  claimTimeoutSec?: number;
}
