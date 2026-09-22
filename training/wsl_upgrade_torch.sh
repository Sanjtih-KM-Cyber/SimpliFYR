#!/bin/bash
export PIP_BREAK_SYSTEM_PACKAGES=1
python3 -m pip install --user --progress-bar=off --upgrade torch --index-url https://download.pytorch.org/whl/cu126 2>&1 | tail -2
python3 -c 'import torch; print(torch.__version__, torch.cuda.is_available())' 2>&1 | tail -1
