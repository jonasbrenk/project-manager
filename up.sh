#!/bin/bash
set -euo pipefail

LOG_FILE="log.txt"
SEPARATOR="------------------------------"

print_latest_log_block() {
    awk -v sep="$SEPARATOR" '
        $0 == sep { block=""; next }
        { block = block $0 "\n" }
        END {
            if (block != "") printf "%s", block
        }
    ' "$LOG_FILE"
}

echo "Activate venv..."
source .venv/bin/activate

cd app

echo -e "\nStarting up ..."
echo -e "\n$SEPARATOR\n" >> "../$LOG_FILE"

nohup python3 main.py project-manager >> "../$LOG_FILE" 2>&1 &
APP_PID=$!

sleep 2

echo "Status:"
if kill -0 "$APP_PID" 2>/dev/null; then
    echo "App is running. PID: $APP_PID"
else
    echo "App is not running."
fi

cd ..

echo
echo "Latest log block:"
print_latest_log_block

echo -e "\nDone."
