# Training (Phase 5.3, all-local) — RTX 3050 4GB / 16GB RAM

Fine-tune Qwen2.5-1.5B-Instruct with QLoRA on Simplifyr's own approval data,
entirely on this machine (WSL2 Ubuntu for training, Windows for serving).

## 0. One-time environment (done, kept here for rebuilds)

WSL2 Ubuntu, no sudo needed: user-space `pip` (`get-pip.py --user`), then
`torch cu121` + `transformers` + `peft` + `bitsandbytes` + `datasets`.
(See `training/wsl_setup.sh`.) Note: current Unsloth requires torch ≥ 2.8
(`FSDPModule`); the working path is the vanilla stack in `train_hf.py`.

## 1. Data (v2: 2406 records, train 2110)

```powershell
.\.venv\Scripts\python.exe training\augment.py      # bootstrap pairs
.\.venv\Scripts\python.exe training\combine_data.py # + export-training approvals
```

Deterministic seed: re-running refreshes `training/data/combined.jsonl`
byte-identically for the same approvals. v2 adds bare-word spellings
(`source`, `destination`) and empty-field abstention — both gaps the v1
model exposed on the gate. Sync into WSL before training:
`cp training/data/combined.jsonl ~/st/`.

## 2. Weights (done: `~/hf-models/Qwen2.5-1.5B-Instruct`, 2.9 GB)

HuggingFace CDN is ~KB/s from this network — fetch once with resume support
(`training/wsl_fetch_weights.sh`, re-runnable). Keep the directory; every
retrain reuses it.

## 3. Train (~90 min for 2 epochs, RTX 3050)

Run in your own terminal (no timeout there), from PowerShell:

```powershell
wsl -d Ubuntu bash -c "rm -rf ~/st/out/checkpoints && cd ~ && MODEL_DIR=~/hf-models/Qwen2.5-1.5B-Instruct TRAIN_DATA=~/st/combined.jsonl TRAIN_OUT=~/st/out python3 ~/st/train_hf.py"
```

Sync `train_hf.py` into `~/st/` first if it changed. Step checkpoints every
50 (resumable mid-run by re-running without the `rm`). Healthy curve:
0.89 → ~0.17. Ends with `SAVED ALL` (merged fp16 in `~/st/out/` — copy back
to `training/out/simplifyr-1.5b-fp16`).

## 4. Convert + serve (no llama.cpp build needed)

```bash
wsl -d Ubuntu bash training/wsl_gguf_convert.sh   # pure-python GGUF f16
ollama rm simplifyr:1.5b
ollama create simplifyr:1.5b -f training/Modelfile-simplifyr
AI_PROVIDER=ollama OLLAMA_MODEL=simplifyr:1.5b
```

Lessons paid for in debugging: merge LoRA with plain torch (peft fights
the pinned torch over torchao versions); untie `lm_head` (Ollama's
importer needs the explicit tensor — tied saves route to the broken MLX
runner on Windows); import GGUF directly, never the experimental
safetensors path. Keep `num_gpu` low (10): only ~2.8 GB VRAM is free.

## 5. Gate (must pass before the model is real)

`run_eval()` on the new model must beat `tests/golden/baseline.json`
(F1 0.9333, drift 1.0, abstention 1.0). Reference measurements:

| model | F1 | drift | abstain |
|---|---|---|---|
| heuristic | 0.9333 | 1.0 | 1.0 |
| generic qwen2.5:1.5b | 0.0 | 0.75 | 0.0 |
| simplifyr v1 (2.4k rows) | 0.9836 | 0.5 | 0.5 |
| simplifyr v2 (2.4k rows, merged 2026-09-24) | 1.0 | 1.0 | 1.0 |

v1 beat the baseline on mapping but lost drift/abstention — that failure
analysis wrote the v2 data section above. v2 (2026-09-24) is green on all
four, so it may set `AI_AUTO_APPLY=true` (≥ 0.9) and serve as
`AI_PROVIDER=ollama OLLAMA_MODEL=simplifyr:1.5b`. Only a model green on all
four may hold those settings.

## Layout (binaries never committed)

- `augment.py`, `combine_data.py`, `train_hf.py`, `wsl_*.sh`,
  `Modelfile-simplifyr` — committed.
- `data/*.jsonl`, `out/`, `tools/`, `*.gguf` — gitignored, reproducible.
