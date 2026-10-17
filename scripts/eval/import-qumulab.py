"""Convert the pinned QuMuLab action table into inspectable NL/PDDL pairs.

The upstream .xml file is a Python pickle. Only the primitive opcodes observed
in the pinned source are accepted before loading it; no classes or callables
can be resolved. Output pairs are source references, not curated gold labels.
"""

import json
import hashlib
import pickle
import pickletools
import sys
from pathlib import Path

SOURCE_COMMIT = "61899bac8608baa719687adbbf0a9928fc06a106"
SOURCE_SHA256 = "238bb4f6927a12aa5755397cede7e83974bd9056511725ec8375b476345c421a"
ALLOWED_OPCODES = {
    "APPENDS", "BINGET", "BINUNICODE", "EMPTY_DICT", "EMPTY_LIST",
    "FRAME", "MARK", "MEMOIZE", "PROTO", "SETITEMS",
    "SHORT_BINUNICODE", "STOP",
}


class PrimitiveUnpickler(pickle.Unpickler):
    def find_class(self, module: str, name: str):
        raise ValueError(f"pickle global forbidden: {module}.{name}")


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: import-qumulab.py <pinned-actions.xml> <pairs.json>")
    source, output = map(Path, sys.argv[1:])
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != SOURCE_SHA256:
        raise ValueError("source does not match the pinned QuMuLab action table")
    opcodes = {opcode.name for opcode, _, _ in pickletools.genops(data)}
    extra = opcodes - ALLOWED_OPCODES
    if extra:
        raise ValueError(f"unexpected pickle opcodes: {sorted(extra)}")
    with source.open("rb") as stream:
        table = PrimitiveUnpickler(stream).load()
    if not isinstance(table, dict):
        raise ValueError("expected an action table")
    pairs = []
    for family, value in table.items():
        if not isinstance(family, str) or not isinstance(value, list) or len(value) != 2:
            raise ValueError(f"invalid action record: {family!r}")
        reference, descriptions = value
        if not isinstance(reference, dict) or not isinstance(descriptions, list):
            raise ValueError(f"invalid action content: {family}")
        required = {"name", "parameters", "duration", "condition", "effect"}
        if set(reference) != required or not all(isinstance(v, str) for v in reference.values()):
            raise ValueError(f"invalid PDDL fields: {family}")
        for index, description in enumerate(descriptions, 1):
            if not isinstance(description, str) or not description.strip():
                raise ValueError(f"invalid description: {family}/{index}")
            pairs.append({
                "id": f"qumulab-{family}-{index}",
                "family": family,
                "description": description.strip(),
                "referenceAction": reference,
                "sourceUrl": f"https://github.com/QuMuLab/temporal-nl-to-pddl/blob/{SOURCE_COMMIT}/Data/actions.xml",
            })
    output.write_text(json.dumps(pairs, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {len(pairs)} source pairs from {len(table)} actions to {output}.")


if __name__ == "__main__":
    main()
