#!/bin/bash


echo "Killing following processes:"
ps aux | grep project-manager | grep -v grep

kill $(pgrep -f 'project-manager')

echo "Done."
