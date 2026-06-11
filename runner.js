const { spawn } = require('child_process');
const fs = require('fs');

const child = spawn('npx', ['next', 'dev', '-p', '3000'], {
  cwd: '/home/z/my-project',
  detached: true,
  stdio: ['ignore', fs.openSync('/home/z/my-project/dev.log', 'w'), fs.openSync('/home/z/my-project/dev.log', 'a')]
});

child.unref();
fs.writeFileSync('/tmp/nextjs.pid', child.pid.toString());
console.log('Server started with PID:', child.pid);
