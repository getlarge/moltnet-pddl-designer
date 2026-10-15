import { hasErrors } from '@pddl/domain/check';
import type {
  ActionsResult,
  Domain,
  PredicatesResult,
  TypesResult,
} from '@pddl/domain/ir';
import {
  buildGroundingRequest,
  type GroundingTarget,
} from '@pddl/domain/source-grounding';
import { RunConflict } from './run-service.js';
import type { RunSnapshot } from '@pddl/contracts/api';

/** Both production and test services derive claims from the current persisted gate. */
export function previewSource(
  snapshot: RunSnapshot,
  gateId: string,
  targets: GroundingTarget[],
) {
  const gate = snapshot.gate;
  if (
    snapshot.state !== 'awaiting' ||
    !gate ||
    gate.id !== gateId ||
    gate.stage !== 'actions' ||
    hasErrors(gate.issues)
  )
    throw new RunConflict(
      'Choose the current valid Actions draft before checking its source.',
    );
  const rows = snapshot.events.flatMap(({ event }) =>
    event.type === 'stage-result' ? [event.record] : [],
  );
  const domain: Domain = {
    name: snapshot.input.domainName,
    types: (rows.findLast((r) => r.stage === 'types')!.result as TypesResult)
      .types,
    predicates: (
      rows.findLast((r) => r.stage === 'predicates')!.result as PredicatesResult
    ).predicates,
    actions: (gate.result as ActionsResult).actions,
  };
  return buildGroundingRequest(
    snapshot.input.description,
    domain,
    targets,
    snapshot.input.problemDescription,
  );
}
