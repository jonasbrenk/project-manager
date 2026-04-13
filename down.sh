#!/bin/bash

if ! pgrep -f 'project-manager' >/dev/null 2>&1; then
    echo "No matching process found."
    echo "Done."
    exit 0
fi

echo "Killing following processes:"
pgrep -af 'project-manager'

kill $(pgrep -f 'project-manager') 2>/dev/null || true

echo "Done."
