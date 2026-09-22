"""Combine export-training output + augmented bootstrap into one dataset file."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import os

os.environ["SYSLOG_ENABLED"] = "false"

from fastapi.testclient import TestClient

from app.main import app

with TestClient(app) as client:
    res = client.get("/api/v1/system/export-training?limit=5000")
    assert res.status_code == 200, res.text
    exported = [json.loads(line) for line in res.text.strip().splitlines() if line.strip()]

augmented_path = ROOT / "training" / "data" / "augmented.jsonl"
augmented = [json.loads(line) for line in augmented_path.read_text(encoding="utf-8").splitlines() if line.strip()]

seen = set()
combined = []
for record in exported + augmented:
    key = (record["input"], record["output"])
    if key in seen:
        continue
    seen.add(key)
    combined.append(record)

dest = ROOT / "training" / "data" / "combined.jsonl"
dest.write_text("\n".join(json.dumps(r) for r in combined) + "\n", encoding="utf-8")
trains = sum(1 for r in combined if r.get("meta", {}).get("split") == "train")
print(f"exported={len(exported)} augmented={len(augmented)} combined={len(combined)} train={trains}")
