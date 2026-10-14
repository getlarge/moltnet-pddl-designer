import type { DesignEvent, DesignRun, StageGate } from '../src/workflow.js';
import type { DesignInput, StageName } from '../src/stages.js';
export type RunInput = Omit<DesignInput, 'correlationId'>;
export interface WarningReviewSettings {
  profileId: string;
}
export interface Gate extends StageGate {
  id: string;
}
export interface RunSnapshot {
  id: string;
  input: DesignRun['input'];
  startedAt: number;
  sequence: number;
  state: 'running' | 'awaiting' | 'finished' | 'failed' | 'offline';
  warningReview?: WarningReviewSettings;
  events: Array<{ at: number; event: DesignEvent }>;
  gate?: Gate;
  run?: DesignRun;
  error?: string;
}
export interface SavedItem {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
  error?: string;
}
export interface StartRequest {
  warningReview?: WarningReviewSettings;
  input: RunInput;
  savedId?: string;
  stage?: StageName;
  feedback?: string;
  claimTimeoutSec?: number;
}
