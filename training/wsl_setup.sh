#!/bin/bash
# Phase 5.3 ML environment bootstrap inside WSL2 Ubuntu (no sudo needed).
# User-space pip, then torch CUDA. Run once:
#   bash training/wsl_setup.sh
set -e
export PIP_BREAK_SYSTEM_PACKAGES=1
cd ~
curl -sSLO https://bootstrap.pypa.io/get-pip.py
python3 get-pip.py --user 2>&1 | tail -1
python3 -m pip install --user --progress-bar=off torch --index-url https://download.pytorch.org/whl/cu121 2>&1 | tail -1
python3 -m pip install --user --progress-bar=off transformers peft bitsandbytes datasets 2>&1 | tail -1
python3 -c 'import torch, transformers, peft, bitsandbytes; print("ml env ok", torch.__version__, torch.cuda.is_available())'
