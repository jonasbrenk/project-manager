#!/bin/bash

echo "Activate venv..."
source .venv/bin/activate

echo "\nSTarting server in bg..."
echo "\n\n----\n\n" >> log.txt
nohup python3 main.py project-manager > log.txt 2>&1 &

