#!/bin/bash
# Convert merged fp16 safetensors -> GGUF f16 (pure python, no compiler).
# Run inside WSL2 Ubuntu: bash training/wsl_gguf_convert.sh
set -e
export PIP_BREAK_SYSTEM_PACKAGES=1
python3 -m pip install --user --progress-bar=off gguf 2>&1 | tail -1
if [ ! -d ~/llama.cpp ]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp ~/llama.cpp 2>&1 | tail -1
fi
python3 ~/llama.cpp/convert_hf_to_gguf.py \
  /mnt/d/MyDesktop/SIMPLIFYR_2_Backup_2/SIMPLIFYR_2/training/out/simplifyr-1.5b-fp16 \
  --outfile /mnt/d/MyDesktop/SIMPLIFYR_2_Backup_2/SIMPLIFYR_2/training/out/simplifyr-1.5b-f16.gguf \
  --outtype f16
echo "GGUF READY"
