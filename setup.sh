#!/bin/bash

echo "-- STARTUP SCRIPT --"


echo "Install venv library..."

sudo apt install python3.10-venv

echo "Creating venv..."

python3 -m venv .venv

echo "Venv created in '.venv/'"

echo "Activating..."

source .venv/bin/activate

echo "Installing requirements from 'requirements.txt'..."

pip install -r requirements.txt

echo "--  STARTUP DONE  --"
