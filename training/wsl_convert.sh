#!/bin/bash
# Convert merged fp16 -> GGUF Q4_K_M for Ollama (Phase 5.3).
# Downloads a prebuilt llama.cpp Linux release (no build needed), converts
# training/out/simplifyr-1.5b-fp16, quantizes, and drops the result where
# Modelfile-simplifyr expects it. Run inside WSL2 Ubuntu AFTER training:
#   bash training/wsl_convert.sh
set -e
REPO="/mnt/d/MyDesktop/SIMPLIFYR_2_Backup_2/SIMPLIFYR_2"
OUT="$REPO/training/out"
LLAMA="$REPO/training/tools/llama.cpp"
mkdir -p "$LLAMA" "$OUT/gguf"
if [ ! -f "$LLAMA/llama-convert-hf-to-gguf.py" ]; then
  echo "downloading llama.cpp release..."
  curl -sSL -o /tmp/llama.tar.gz https://github.com/ggerganov/llama.cpp/releases/download/b6485/llama-b6485-bin-ubuntu-x64.tar.gz
  tar -xzf /tmp/llama.tar.gz -C "$LLAMA"
fi
python3 "$LLAMA/llama-convert-hf-to-gguf.py" "$OUT/simplifyr-1.5b-fp16" \
  --outfile "$OUT/gguf/simplifyr-1.5b-f16.gguf" --outtype f16
"$LLAMA/build/bin/llama-quantize" "$OUT/gguf/simplifyr-1.5b-f16.gguf" \
  "$OUT/gguf/simplifyr-1.5b-Q4_K_M.gguf" Q4_K_M
echo "GGUF READY: $OUT/gguf/simplifyr-1.5b-Q4_K_M.gguf"
