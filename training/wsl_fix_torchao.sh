#!/bin/bash
export PIP_BREAK_SYSTEM_PACKAGES=1
python3 -m pip install --user --progress-bar=off 'torchao==0.10.0' 2>&1 | tail -1
python3 -c 'import unsloth; print("unsloth ok")' 2>&1 | tail -1
