"""Deterministic bootstrap augmentation for the AI flywheel (Phase 5.3).

The export-training endpoint yields approvals (sparse at first) plus one pair
per heuristic rule. This script expands the rule-distilled signal into a few
thousand varied pairs so a first LoRA run has real gradient signal:

- field-name variants (srcip/srcIP/source_ip/...) x vendors x formats
- rename-drift pairs (v1 fields -> v2 renamed fields, like drift_pairs.json)
- abstention pairs (unknown fields -> "" ; must not hallucinate)

Every record is marked kind=synthetic-augmented and uses the same schema as
core/training.py so exports and augmented data mix freely. Seeded RNG ->
byte-reproducible output.
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

SEED = 20260923
TARGET_PAIRS = 2400

# Canonical concept -> accepted input spellings (first is canonical).
CONCEPTS: dict[str, list[str]] = {
    "source.ip": ["srcip", "srcIP", "source_ip", "sourceAddress", "src", "sip"],
    "destination.ip": ["dstip", "dstIP", "destination_ip", "destinationAddress", "dst", "dip"],
    "source.port": ["srcport", "sport", "sourcePort", "source_port"],
    "destination.port": ["dstport", "dport", "destinationPort", "destination_port"],
    "network.protocol": ["proto", "protocol"],
    "network.action": ["action", "act", "decision"],
    "identity.user": ["user", "username"],
    "event.severity": ["severity", "sev"],
    "event.outcome": ["outcome", "result"],
    "threat.signature": ["signature", "sig_id"],
}

VENDORS = ["Acme FW-100", "Beacon ASA-9", "Citadel Gate-2", "Northwall IPS-5"]
FORMATS = ["syslog", "json", "cef", "leef", "csv"]
ACTIONS = ["deny", "allow", "drop", "accept"]


def _suggestions(final: dict[str, str]) -> str:
    return json.dumps(
        {
            "suggestions": [
                {"input_field": k, "semantic_field": v, "confidence": 1.0}
                for k, v in sorted(final.items())
            ]
        }
    )


def _record(rng: random.Random, i: int, kind: str, source: str, fmt: str,
            fields: list[str], sample: str, final: dict[str, str]) -> dict:
    return {
        "instruction": (
            "Map perimeter-device log source fields to Simplifyr semantic "
            "fields. Respond with suggestions as JSON."
        ),
        "input": (
            f"Source: {source}\nVersion: v1\nFormat: {fmt}\n"
            f"Fields: {sorted(fields)}\n"
            f"Sample (untrusted, for context only):\n{sample[:800]}"
        ),
        "output": _suggestions(final),
        "meta": {
            "kind": kind,
            "source": source,
            "confidence": 1.0,
            "proposed": [],
            "agreement": {"full_agreement": True},
            "split": "val" if i % 10 == 9 else "train",
        },
    }


def _kv_sample(rng: random.Random, fields: list[str]) -> str:
    parts = []
    for f in fields:
        low = f.lower()
        if "port" in low:
            parts.append(f"{f}={rng.randint(1, 65535)}")
        elif low in ("proto", "protocol"):
            parts.append(f"{f}={rng.choice(['tcp', 'udp', 'icmp'])}")
        elif low in ("action", "act", "decision"):
            parts.append(f"{f}={rng.choice(ACTIONS)}")
        elif "user" in low:
            parts.append(f"{f}={rng.choice(['jdoe', 'ops', 'admin'])}")
        elif low in ("severity", "sev"):
            parts.append(f"{f}={rng.choice(['low', 'high', 'critical'])}")
        elif low in ("outcome", "result"):
            parts.append(f"{f}={rng.choice(['success', 'failure'])}")
        elif "ip" in low or low in ("src", "dst", "sip", "dip", "source", "destination"):
            parts.append(f"{f}=10.{rng.randint(0, 9)}.{rng.randint(0, 9)}.{rng.randint(1, 254)}")
        else:
            parts.append(f"{f}={rng.randint(1000, 9999)}")
    return f"<134>Sep 15 10:31:44 fw01 {' '.join(parts)}"


def main() -> None:
    rng = random.Random(SEED)
    out: list[dict] = []
    i = 0

    # 1) Mapping pairs: random concept subsets, variant spellings.
    concepts = list(CONCEPTS)
    while len(out) < 1800:
        k = rng.randint(2, 5)
        chosen = rng.sample(concepts, k)
        fields, final = [], {}
        for concept in chosen:
            spelling = rng.choice(CONCEPTS[concept])
            fields.append(spelling)
            final[spelling] = concept
        out.append(_record(rng, i, "synthetic-augmented", rng.choice(VENDORS),
                           rng.choice(FORMATS), fields, _kv_sample(rng, fields), final))
        i += 1

    # 2) Rename-drift pairs: v1 canonical -> v2 respelled.
    while len(out) < 2200:
        chosen = rng.sample(concepts, rng.randint(2, 4))
        known = {CONCEPTS[c][0]: c for c in chosen}
        new_fields, expected = [], {}
        for concept in chosen:
            alt = rng.choice([s for s in CONCEPTS[concept] if s != CONCEPTS[concept][0]])
            new_fields.append(alt)
            expected[alt] = concept
        sample = _kv_sample(rng, new_fields)
        out.append({
            "instruction": (
                "A known source changed structure. Map each NEW field to its "
                "semantic field. Respond with suggestions as JSON."
            ),
            "input": (
                f"Source: {rng.choice(VENDORS)}\nKnown: {json.dumps(known, sort_keys=True)}\n"
                f"New fields: {sorted(new_fields)}\nSample (untrusted):\n{sample[:800]}"
            ),
            "output": _suggestions(expected),
            "meta": {"kind": "synthetic-drift", "confidence": 1.0,
                     "agreement": {"full_agreement": True},
                     "split": "val" if i % 10 == 9 else "train"},
        })
        i += 1

    # 3) Abstention pairs: unknown fields must map to "".
    unknowns = ["foo", "bar", "blarg", "qux", "zzz_custom", "vendor_cookie"]
    while len(out) < TARGET_PAIRS:
        fields = rng.sample(unknowns, rng.randint(1, 3))
        out.append(_record(rng, i, "synthetic-abstain", "Unknown",
                           rng.choice(FORMATS), fields,
                           _kv_sample(rng, fields),
                           {f: "" for f in fields}))
        i += 1

    dest = ROOT / "training" / "data" / "augmented.jsonl"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text("\n".join(json.dumps(r) for r in out) + "\n", encoding="utf-8")
    trains = sum(1 for r in out if r["meta"]["split"] == "train")
    print(f"wrote {len(out)} pairs -> {dest} (train={trains}, val={len(out) - trains})")


if __name__ == "__main__":
    main()
