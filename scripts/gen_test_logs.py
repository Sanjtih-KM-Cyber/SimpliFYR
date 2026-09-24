"""Generate limit-testing telemetry: mixed formats, drift shapes, garbage.

Usage (repo root):
    .\\.venv\\Scripts\\python.exe scripts\\gen_test_logs.py [lines] [outfile]

Defaults: 5000 lines -> scripts/test_firehose.log

Deterministic (seed 7): same file every run, so dedup/drift/merge results
are exactly checkable. Paste into Trial Run, drop into Analytics Dedup,
or POST chunks to /api/v1/process/batch.
"""

import random
import sys

SEED = 7

# Share of each shape. Shapes B and E are the SAME new-field drift on two
# vendors (each should collapse to one drift item); D is a second drift
# shape on vendor A (stays its own item).
SHAPES = [
    ("A", 0.50),  # vendor A baseline syslog
    ("B", 0.20),  # vendor A + 2 NEW fields (drift shape 1)
    ("C", 0.12),  # vendor B baseline syslog
    ("D", 0.08),  # vendor A + 1 other new field (drift shape 2)
    ("E", 0.05),  # vendor B + same 2 new fields as B (drift shape 1, other vendor)
    ("F", 0.03),  # JSON
    ("G", 0.01),  # CEF
    ("H", 0.01),  # garbage (DLQ bait)
]


def line(shape: str, i: int, rng: random.Random) -> str:
    ip = f"10.1.{rng.randint(0, 9)}.{rng.randint(2, 254)}"
    ts = f"Sep 15 10:{30 + (i // 3600) % 30:02d}:{(i // 60) % 60:02d}"
    if shape == "A":
        return f"<134>{ts} fw01 srcip={ip} dstip=8.8.8.8 proto=tcp action=deny"
    if shape == "B":
        return f"<134>{ts} fw01 srcip={ip} dstip=8.8.8.8 proto=tcp action=deny ruleid={1000 + i % 50} threatlvl=high"
    if shape == "C":
        return f"<134>{ts} fw02 srcip={ip} dstip=1.1.1.1 proto=udp action=allow"
    if shape == "D":
        return f"<134>{ts} fw01 srcip={ip} dstip=8.8.8.8 proto=tcp action=deny sessionbytes={rng.randint(64, 9000)}"
    if shape == "E":
        return f"<134>{ts} fw02 srcip={ip} dstip=1.1.1.1 proto=udp action=allow ruleid={2000 + i % 50} threatlvl=med"
    if shape == "F":
        return (
            '{"timestamp": "2026-09-24T10:00:00Z", "sourceAddress": "%s", '
            '"destinationAddress": "8.8.8.8", "protocol": "tcp", "action": "deny"}' % ip
        )
    if shape == "G":
        return f"CEF:0|VendorX|FirewallY|6.5|1001|Firewall Deny|5|src={ip} dst=8.8.8.8 proto=tcp act=deny"
    return rng.choice(
        [
            "totally unstructured [[[ junk",
            "hello world test payload",
            "",
            "   ",
        ]
    )


def main() -> None:
    total = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    out = sys.argv[2] if len(sys.argv) > 2 else "scripts/test_firehose.log"
    rng = random.Random(SEED)
    picks = [s for s, w in SHAPES for _ in range(int(w * 100))]
    counts: dict[str, int] = {}
    with open(out, "w", encoding="utf-8") as fh:
        for i in range(total):
            shape = rng.choice(picks)
            text = line(shape, i, rng)
            if not text.strip():
                continue
            fh.write(text + "\n")
            counts[shape] = counts.get(shape, 0) + 1
    print(f"wrote {out}")
    for shape in sorted(counts):
        print(f"  shape {shape}: {counts[shape]} lines")


if __name__ == "__main__":
    main()
