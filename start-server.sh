#!/bin/bash
cd /home/z/my-project

# Ensure we use the Neon PostgreSQL URL from .env, not any system-level SQLite override
unset DATABASE_URL
unset DIRECT_URL

while true; do
  npx next dev -p 3000
  echo "Server crashed, restarting..."
  sleep 2
done
