/** Convert the pinned QuMuLab pickle (named actions.xml) into NL/PDDL pairs. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { Parser } from 'pickleparser';
import { assertDistinctFilePaths } from './distinct-paths.js';

const SOURCE_COMMIT = '61899bac8608baa719687adbbf0a9928fc06a106';
const SOURCE_SHA256 =
  '238bb4f6927a12aa5755397cede7e83974bd9056511725ec8375b476345c421a';
const ACTION_FIELDS = ['condition', 'duration', 'effect', 'name', 'parameters'];

function assertPrimitiveOpcodes(data: Buffer): void {
  let offset = 0;
  const skip = (length: number) => {
    if (offset + length > data.length)
      throw new Error('Truncated QuMuLab pickle opcode argument.');
    offset += length;
  };
  while (offset < data.length) {
    const opcode = data[offset++];
    switch (opcode) {
      // The pinned file only contains primitive containers, strings, and memo reads.
      case 0x28: // MARK
      case 0x2e: // STOP
      case 0x5d: // EMPTY_LIST
      case 0x65: // APPENDS
      case 0x75: // SETITEMS
      case 0x7d: // EMPTY_DICT
      case 0x94: // MEMOIZE
        if (opcode === 0x2e) {
          if (offset !== data.length)
            throw new Error('Unexpected bytes after the QuMuLab pickle.');
          return;
        }
        break;
      case 0x68: // BINGET
      case 0x80: // PROTO
        skip(1);
        break;
      case 0x95: // FRAME
        skip(8);
        break;
      case 0x8c: {
        // SHORT_BINUNICODE
        skip(1);
        skip(data[offset - 1]);
        break;
      }
      case 0x58: {
        // BINUNICODE
        if (offset + 4 > data.length)
          throw new Error('Truncated QuMuLab pickle opcode argument.');
        const length = data.readUInt32LE(offset);
        skip(4);
        skip(length);
        break;
      }
      default:
        throw new Error(`Unexpected pickle opcode 0x${opcode.toString(16)}.`);
    }
  }
  throw new Error('QuMuLab pickle has no STOP opcode.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath)
  throw new Error(
    'Usage: pnpm eval:temporal:import-qumulab <pinned-actions.xml> <pairs.json>',
  );
assertDistinctFilePaths([sourcePath, outputPath]);
const data = readFileSync(sourcePath);
if (createHash('sha256').update(data).digest('hex') !== SOURCE_SHA256)
  throw new Error('Source does not match the pinned QuMuLab action table.');
assertPrimitiveOpcodes(data);

const table: unknown = new Parser({
  nameResolver: {
    resolve(module, name) {
      throw new Error(`Pickle global forbidden: ${module}.${name}`);
    },
  },
  persistentResolver: {
    resolve() {
      throw new Error('Pickle persistent reference forbidden.');
    },
  },
  extensionResolver: {
    resolve() {
      throw new Error('Pickle extension forbidden.');
    },
  },
}).parse(data);
if (!isRecord(table)) throw new Error('Expected an action table.');

const pairs = [];
for (const [family, value] of Object.entries(table)) {
  if (!Array.isArray(value) || value.length !== 2)
    throw new Error(`Invalid action record: ${family}`);
  const [referenceAction, descriptions]: unknown[] = value;
  if (!isRecord(referenceAction) || !Array.isArray(descriptions))
    throw new Error(`Invalid action content: ${family}`);
  if (
    JSON.stringify(Object.keys(referenceAction).sort()) !==
      JSON.stringify(ACTION_FIELDS) ||
    !Object.values(referenceAction).every((field) => typeof field === 'string')
  )
    throw new Error(`Invalid PDDL fields: ${family}`);
  for (const [index, description] of descriptions.entries()) {
    if (typeof description !== 'string' || !description.trim())
      throw new Error(`Invalid description: ${family}/${index + 1}`);
    pairs.push({
      id: `qumulab-${family}-${index + 1}`,
      family,
      description: description.trim(),
      referenceAction,
      sourceUrl: `https://github.com/QuMuLab/temporal-nl-to-pddl/blob/${SOURCE_COMMIT}/Data/actions.xml`,
    });
  }
}
writeFileSync(outputPath, JSON.stringify(pairs, null, 2) + '\n');
process.stdout.write(
  `Wrote ${pairs.length} source pairs from ${Object.keys(table).length} actions to ${outputPath}.\n`,
);
