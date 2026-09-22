# Training (Phase 5.3, all-local) — RTX 3050 4GB / 16GB RAM

Fine-tune Qwen2.5-1.5B-Instruct with QLoRA on Simplifyr's own approval data,
entirely on this machine (WSL2 Ubuntu for training, Windows for serving).

## 0. One-time environment (done 2026-09-23, kept here for rebuilds)

WSL2 Ubuntu, no sudo needed: user-space `pip` (`get-pip.py --user`), then
`torch cu121` + `unsloth` + `trl` + `datasets`. Note: current Unsloth
requires torch ≥ 2.8 (`FSDPModule`); if versions skew again, either upgrade
torch (`training/wsl_upgrade_torch.sh`) or train with the vanilla stack
(`training/train_hf.py`, transformers + peft + bitsandbytes, torch 2.5 OK).

## 1. Data

```powershell
.\.venv\Scripts\python.exe training\augment.py      # 2400 bootstrap pairs
.\.venv\Scripts\python.exe training\combine_data.py # + export-training approvals
```

Output: `training/data/combined.jsonl` (2435 rows now; regrow as approvals
accumulate — re-running export + combine refreshes it deterministically).

## 2. Weights (the slow part)

HuggingFace CDN is ~KB/s from this network. Fetch with resume support
(overnight is fine — re-running continues):

```bash
bash training/wsl_fetch_weights.sh   # -> ~/hf-models/Qwen2.5-1.5B-Instruct
```

## 3. Train (RTX 3050, ~1–2 h for 3 epochs)

```bash
MODEL_DIR=~/hf-models/Qwen2.5-1.5B-Instruct python3 training/train_hf.py
```

Checkpoints per epoch in `training/out/checkpoints` (resumable). Merged fp16
lands in `training/out/simplifyr-1.5b-fp16`.

## 4. Convert + serve

```bash
bash training/wsl_convert.sh        # -> training/out/gguf/simplifyr-1.5b-Q4_K_M.gguf
ollama create simplifyr:1.5b -f training/Modelfile-simplifyr
AI_PROVIDER=ollama OLLAMA_MODEL=simplifyr:1.5b
```

## 5. Gate (must pass before the model is real)

```powershell
.\.venv\Scripts\python.exe <eval-vs-baseline>
```

i.e. `run_eval()` on the new model must beat `tests/golden/baseline.json`
(F1 0.9333). Reference measurements: heuristic 0.9333, **generic
qwen2.5:1.5b 0.0** (invents `source.srcip`-style fields — exactly what the
fine-tune fixes). Only then consider `AI_AUTO_APPLY=true` at ≥ 0.9.

## Layout (binaries never committed)

- `augment.py`, `combine_data.py`, `train_hf.py`, `unsloth_train.py` (alt),
  `wsl_*.sh`, `Modelfile-simplifyr` — committed.
- `data/*.jsonl`, `out/`, `tools/`, `*.gguf` — gitignored, reproducible.
