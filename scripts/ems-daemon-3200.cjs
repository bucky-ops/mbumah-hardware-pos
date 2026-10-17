#!/usr/bin/env node
// Double-fork launcher for the :3200 QA daemon (recreated v2.88.0 round).
//
// WHY THIS EXISTS: nohup/setsid backgrounding dies at the tool-call
// boundary — the sandbox reaps the process group. A detached
// (setsid-equivalent) spawn that exits immediately orphans the server to
// init, which survives. This is the ONLY reliable way to run :3200 here.
//
// Usage: node scripts/ems-daemon-3200.cjs   (returns immediately)

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const CWD = path.resolve(__dirname, '..');
const LOG = path.join(CWD, 'server-3200.log');

const child = spawn(
  process.execPath,
  [path.join(CWD, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', '3200'],
  {
    cwd: CWD,
    detached: true,
    stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')],
    env: {
      ...process.env,
      DATABASE_URL: 'file:/home/z/ems/prisma/prisma/dev.db',
      NODE_ENV: 'production',
      PORT: '3200',
    },
  },
);

child.unref();
console.log(`daemon pid ${child.pid} → http://localhost:3200 (log: ${LOG})`);
process.exit(0);
