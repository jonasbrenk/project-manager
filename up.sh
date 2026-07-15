#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

mkdir -p app/data

echo "Building and starting Project Manager..."
docker compose up --detach --build --wait

echo
docker compose ps
echo
echo "Project Manager is available at http://localhost:5000"
