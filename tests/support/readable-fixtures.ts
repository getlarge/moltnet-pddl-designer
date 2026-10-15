import { blocksDomain } from '@pddl/domain/test-fixtures';
import type { Domain } from '@pddl/domain/ir';

/** Hand-authored demo drafts; stack and process deliberately omit a deletion. */
export const readableBlocksDomain = structuredClone(blocksDomain);
const meanings: Record<string, [string, string]> = {
  'on-table': ['{?b} is on the table', '{?b} is not on the table'],
  'on-block': ['{?b1} is on top of {?b2}', '{?b1} is not on top of {?b2}'],
  clear: ['nothing is on top of {?b}', 'a block is on top of {?b}'],
  'held-by-arm': ['{?a} holds {?b}', '{?a} does not hold {?b}'],
  'arm-empty': ['{?a} holds no block', '{?a} holds a block'],
};
for (const predicate of readableBlocksDomain.predicates) {
  const [yes, no] = meanings[predicate.name];
  predicate.reading = { true: yes, false: no };
}
const actionWords: Record<string, string> = {
  'pick-up': '{?a} picks {?b} up from the table',
  'put-down': '{?a} puts {?b} down on the table',
  stack: '{?a} places {?b1} on top of {?b2}',
  unstack: '{?a} lifts {?b1} off {?b2}',
};
for (const action of readableBlocksDomain.actions) {
  action.reading = actionWords[action.name];
  for (const p of action.parameters)
    p.label = (
      {
        '?a': 'the arm',
        '?b': 'block B',
        '?b1': 'block A',
        '?b2': 'block B',
      } as Record<string, string>
    )[p.name];
}
readableBlocksDomain.actions.find((a) => a.name === 'stack')!.deleteEffects =
  readableBlocksDomain.actions
    .find((a) => a.name === 'stack')!
    .deleteEffects.filter((p) => p.predicate !== 'clear');
export const parcelInspectionDomain: Domain = {
  name: 'parcel-inspection',
  types: [
    { name: 'parcel', description: 'A parcel to process' },
    {
      name: 'worker',
      description: 'A worker who inspects and processes parcels',
    },
  ],
  predicates: [
    {
      name: 'fresh-inspection',
      parameters: [{ name: '?p', type: 'parcel' }],
      description: 'An unused fresh inspection is available for p',
      reading: {
        true: '{?p} has an unused fresh inspection',
        false: '{?p} does not have an unused fresh inspection',
      },
    },
    {
      name: 'inspection-record',
      parameters: [{ name: '?p', type: 'parcel' }],
      description: 'The historical inspection record for p is available',
      reading: {
        true: 'the inspection record for {?p} is available',
        false: 'the inspection record for {?p} is not available',
      },
    },
    {
      name: 'processed',
      parameters: [{ name: '?p', type: 'parcel' }],
      description: 'p has been processed',
      reading: {
        true: '{?p} has been processed',
        false: '{?p} has not been processed',
      },
    },
  ],
  actions: [
    {
      name: 'inspect',
      parameters: [
        { name: '?w', type: 'worker', label: 'the worker' },
        { name: '?p', type: 'parcel', label: 'the parcel' },
      ],
      reading: '{?w} inspects {?p}',
      preconditions: [],
      addEffects: [
        { predicate: 'fresh-inspection', args: ['?p'] },
        { predicate: 'inspection-record', args: ['?p'] },
      ],
      deleteEffects: [],
      source:
        'The worker inspects a parcel to create a fresh inspection and a historical record.',
    },
    {
      name: 'process',
      parameters: [
        { name: '?w', type: 'worker', label: 'the worker' },
        { name: '?p', type: 'parcel', label: 'the parcel' },
      ],
      reading: '{?w} processes {?p}',
      preconditions: [
        { predicate: 'fresh-inspection', args: ['?p'], negated: false },
        { predicate: 'inspection-record', args: ['?p'], negated: false },
      ],
      addEffects: [{ predicate: 'processed', args: ['?p'] }],
      deleteEffects: [],
      source:
        'Processing uses up the fresh inspection; its historical record remains available.',
    },
  ],
};
