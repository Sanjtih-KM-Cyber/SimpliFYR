#!/bin/bash
# Resume-capable base-weight fetch for the fine-tune (Phase 5.3).
# HuggingFace CDN can be very slow from some networks; huggingface-cli resumes
# partial files, so re-running this is safe. ~3GB for Qwen2.5-1.5B-Instruct.
# Run inside WSL2 Ubuntu:  bash training/wsl_fetch_weights.sh
set -e
export PIP_BREAK_SYSTEM_PACKAGES=1
python3 -m pip install --user --progress-bar=off "huggingface-hub[cli]" 2>&1 | tail -1
python3 -c "import huggingface_hub; print('hub ok')"
python3 -m hf download Qwen/Qwen2.5-1.5B-Instruct \
  --local-dir ~/hf-models/Qwen2.5-1.5B-Instruct \
  --local-dir-use-symlinks False
echo "WEIGHTS READY"
