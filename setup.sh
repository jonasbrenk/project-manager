#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

command -v docker >/dev/null 2>&1 || {
    echo "Docker is required but was not found."
    exit 1
}

docker compose version >/dev/null
mkdir -p app/data
docker compose build

echo "Setup complete. Start the app with ./up.sh"
