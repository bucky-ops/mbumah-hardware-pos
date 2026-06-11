#!/bin/bash
cd /home/z/my-project
while true; do
  npx next dev -p 3000
  echo "Server crashed, restarting..."
  sleep 2
done
