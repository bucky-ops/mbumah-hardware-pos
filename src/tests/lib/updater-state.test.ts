// UNIT TESTS - v2.17.9 staged updater state store (src/lib/updater/state.ts)
//
// Pure filesystem tests: a fresh mkdtempSync directory per test, no database
// and no network. Covers the defensive-read contract (defaults on missing or
// corrupt files), percent clamping, the atomic tmp+rename round trip, error
// path sanitization and the public status projection.

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  ACTIVE_PHASES,
  DEFAULT_UPDATE_STATE,
  buildPublicStatus,
  readUpdateState,
  sanitizeError,
  writeUpdateState,
} from '@/lib/updater/state';

let stateDir: string;
let statePath: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'mbumah-updater-'));
  statePath = join(stateDir, 'update-state.json');
});

describe('readUpdateState (defensive reads)', () => {
  it('returns the idle defaults when the state file does not exist', () => {
    expect(readUpdateState(statePath)).toEqual(DEFAULT_UPDATE_STATE);
  });

  it('returns the idle defaults when the state file is corrupt JSON', () => {
    // A torn write (crash between write and rename) must never 500 the API.
    writeFileSync(statePath, '{"phase": "installing", "percent": 85', 'utf8');
    expect(readUpdateState(statePath)).toEqual(DEFAULT_UPDATE_STATE);
  });

  it('falls back to the idle phase for an unknown phase value', () => {
    writeFileSync(statePath, JSON.stringify({ phase: 'hacked', percent: 10 }), 'utf8');
    expect(readUpdateState(statePath).phase).toBe('idle');
    expect(readUpdateState(statePath).percent).toBe(10);
  });

  it('never exposes an unsanitized error path from a hand-edited file', () => {
    writeFileSync(statePath, JSON.stringify({ error: 'boom /home/agent/secret/path' }), 'utf8');
    expect(readUpdateState(statePath).error).toBe('boom [path]');
  });
});

describe('writeUpdateState', () => {
  it('clamps percent into the 0-100 range', () => {
    expect(writeUpdateState({ percent: 150 }, statePath).percent).toBe(100);
    expect(writeUpdateState({ percent: -5 }, statePath).percent).toBe(0);
  });

  it('round-trips a write atomically (tmp file consumed, file readable)', () => {
    const written = writeUpdateState(
      { phase: 'installing', percent: 85, message: 'Installing the new release', targetVersion: '2.17.9' },
      statePath,
    );
    expect(written.phase).toBe('installing');
    expect(existsSync(`${statePath}.tmp`)).toBe(false);
    const read = readUpdateState(statePath);
    expect(read.phase).toBe('installing');
    expect(read.percent).toBe(85);
    expect(read.message).toBe('Installing the new release');
    expect(read.targetVersion).toBe('2.17.9');
    expect(read.updatedAt).not.toBeNull();
  });

  it('stamps startedAt when a run leaves idle into an active phase', () => {
    expect(readUpdateState(statePath).startedAt).toBeNull();
    writeUpdateState({ phase: 'checking', percent: 2 }, statePath);
    const active = readUpdateState(statePath);
    expect(ACTIVE_PHASES.has(active.phase)).toBe(true);
    expect(active.startedAt).not.toBeNull();
  });

  it('never throws when persistence fails and still returns the merged state', () => {
    // A FILE where the state directory should be: mkdirSync fails inside the
    // writer, the failure is logged, and the caller still gets the state.
    const blocker = join(stateDir, 'blocker');
    writeFileSync(blocker, 'a file, not a folder', 'utf8');
    const blocked = join(blocker, 'update-state.json');
    expect(() => writeUpdateState({ phase: 'checking' }, blocked)).not.toThrow();
    expect(writeUpdateState({ phase: 'checking' }, blocked).phase).toBe('checking');
    expect(existsSync(blocked)).toBe(false);
  });
});

describe('sanitizeError', () => {
  it('strips absolute paths to [path] and collapses whitespace', () => {
    expect(sanitizeError('Failed to read /home/agent/secret/path')).toBe(
      'Failed to read [path]',
    );
    expect(sanitizeError('open /tmp/update-123.tar.gz failed')).toBe('open [path] failed');
    expect(sanitizeError('copy C:\\Users\\admin\\pos.db denied')).toBe('copy [path] denied');
    expect(sanitizeError('line1\n   line2  /var/data/x.db')).toBe('line1 line2 [path]');
  });

  it('caps very long errors at 300 characters', () => {
    expect(sanitizeError('x'.repeat(500))).toHaveLength(300);
  });
});

describe('buildPublicStatus (public projection)', () => {
  it('reports maintenance during active phases and none otherwise', () => {
    expect(
      buildPublicStatus({ ...DEFAULT_UPDATE_STATE, phase: 'installing', percent: 85 }).maintenance,
    ).toBe(true);
    expect(buildPublicStatus({ ...DEFAULT_UPDATE_STATE, phase: 'idle' }).maintenance).toBe(false);
    expect(
      buildPublicStatus({ ...DEFAULT_UPDATE_STATE, phase: 'done', percent: 100 }).maintenance,
    ).toBe(false);
  });

  it('exposes progress fields only (no pid, no error, no startedAt)', () => {
    const status = buildPublicStatus({
      ...DEFAULT_UPDATE_STATE,
      phase: 'installing',
      pid: 123,
      error: 'internal detail',
      startedAt: new Date().toISOString(),
    });
    expect(Object.keys(status).sort()).toEqual([
      'maintenance',
      'message',
      'percent',
      'phase',
      'targetVersion',
      'updatedAt',
    ]);
  });
});
