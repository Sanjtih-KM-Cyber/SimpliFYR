#!/bin/bash
for name in llama-v0.4.1-bin-ubuntu-x64.tar.gz llama-b6485-bin-ubuntu-x64.tar.gz; do
  code=$(curl -sSL -o /tmp/probe.bin -w "%{http_code}:%{size_download}" "https://github.com/ggml-org/llama.cpp/releases/download/v0.4.1/$name")
  echo "$name -> $code"
  head -c 60 /tmp/probe.bin | head -1
done
echo "---DONE---"
