#!/usr/bin/env node
// MBUMAH HARDWARE POS - Write the branch workspace block to the system hosts file
//
// Companion to print-hosts.mjs (which only prints). This script writes an
// idempotent, clearly-marked managed block:
//
//   # BEGIN mbumah-hardware-pos (managed - safe to re-run)
//   ...one line per hostname...
//   # END mbumah-hardware-pos
//
// Usage:
//   npm run domains:write-hosts                    # 127.0.0.1 + mbumah.test
//   node scripts/domains/write-hosts.mjs --ip 192.168.1.20
//   node scripts/domains/write-hosts.mjs --domain mbumah.lan
//   node scripts/domains/write-hosts.mjs --remove  # strip the managed block
//
// Elevation: /etc/hosts (macOS/Linux) and the Windows hosts file are only
// writable by root/Administrator. Without elevation the script prints the
// exact elevated command and exits 1 without touching anything. A timestamped
// backup of the hosts file is taken before every write.

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const configPath = join(scriptDir, 'stores.config.json');
const isWindows = process.platform === 'win32';
const hostsPath = isWindows
  ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  : '/etc/hosts';

const BEGIN = '# BEGIN mbumah-hardware-pos (managed - safe to re-run)';
const END = '# END mbumah-hardware-pos';

function parseArgs(argv) {
  const args = { ip: '127.0.0.1', domain: null, remove: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ip' && argv[i + 1]) { args.ip = argv[i + 1]; i++; }
    else if (a === '--domain' && argv[i + 1]) { args.domain = argv[i + 1]; i++; }
    else if (a === '--remove') { args.remove = true; }
    else if (a === '--help' || a === '-h') { args.help = true; }
  }
  return args;
}

function buildBlock(config, args) {
  const domain = args.domain || config.rootDomainLocal || 'mbumah.test';
  const port = config.defaultPort || 3000;
  const lines = [BEGIN];
  lines.push(`${args.ip}\t${domain}`);
  for (const s of config.stores) {
    lines.push(`${args.ip}\t${s.subdomain}.${domain}`);
  }
  lines.push(END);
  return { block: lines.join('\n') + '\n', domain, port };
}

function isElevated() {
  if (isWindows) {
    // Writing the file is the only reliable check; try a cheap probe instead:
    // fltmc.exe requires admin and exists on every supported Windows.
    const r = spawnSync('fltmc.exe', [], { stdio: 'ignore' });
    return !r.error && r.status === 0;
  }
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

function main() {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/domains/write-hosts.mjs [--ip 127.0.0.1] [--domain mbumah.test] [--remove]');
    process.exit(0);
  }

  if (!existsSync(hostsPath)) {
    console.error(`[write-hosts] x hosts file not found: ${hostsPath}`);
    process.exit(1);
  }

  if (!isElevated()) {
    console.error('[write-hosts] x the hosts file is write-protected; re-run elevated:');
    console.error(isWindows
      ? '    Start-Process PowerShell -Verb RunAs -ArgumentList "-NoProfile -Command npm run domains:write-hosts"'
      : '    sudo npm run domains:write-hosts');
    console.error('    (or paste the block printed by: npm run domains:print)');
    process.exit(1);
  }

  const original = readFileSync(hostsPath, 'utf8');
  const { block, domain } = buildBlock(config, args);

  let next;
  if (args.remove) {
    next = original.replace(new RegExp(`\\n?${BEGIN.replace(/[()]/g, '\\$&')}[\\s\\S]*?${END}\\n?`, 'g'), '\n');
    console.log(`[write-hosts] removing the managed block (${domain}) ...`);
  } else {
    const re = new RegExp(`\\n?${BEGIN.replace(/[()]/g, '\\$&')}[\\s\\S]*?${END}\\n?`, 'g');
    next = re.test(original) ? original.replace(re, '\n' + block) : original.replace(/\n*$/, '\n') + '\n' + block;
    console.log(`[write-hosts] writing the managed block (${domain}) ...`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = `${hostsPath}.mbumah-backup-${stamp}`;
  copyFileSync(hostsPath, backup);
  writeFileSync(hostsPath, next);

  const written = readFileSync(hostsPath, 'utf8');
  const ok = args.remove ? !written.includes(BEGIN) : written.includes(BEGIN) && written.includes(domain);
  if (!ok) {
    console.error(`[write-hosts] x verification failed - restoring the backup from ${backup}`);
    writeFileSync(hostsPath, original);
    process.exit(1);
  }
  console.log(`[write-hosts] OK hosts file updated (backup: ${backup})`);
  if (!args.remove) {
    console.log('[write-hosts]    entries:');
    for (const l of block.trim().split('\n').slice(1, -1)) console.log('[write-hosts]      ' + l);
    console.log('[write-hosts] flush DNS caches if the names do not resolve:');
    console.log('[write-hosts]   macOS:  sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder');
    console.log('[write-hosts]   Windows: ipconfig /flushdns');
  }
}

main();
