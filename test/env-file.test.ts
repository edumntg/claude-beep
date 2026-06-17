import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readEnvFile, upsertEnvVar, loadIntoProcessEnv } from '../src/config/env-file.js';

const tmp = path.join(os.tmpdir(), `cb-env-${process.pid}-${Date.now()}.env`);

describe('env-file', () => {
  beforeEach(() => {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  });

  afterEach(() => {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    delete process.env.CB_TEST_VAR;
    delete process.env.CB_TEST_PRESET;
  });

  it('reads an empty/missing file as {}', () => {
    expect(readEnvFile(tmp)).toEqual({});
  });

  it('parses KEY=VALUE lines, skipping comments and blanks', () => {
    fs.writeFileSync(tmp, '# comment\n\nFOO=bar\nBAZ="quoted value"\nQUX=\'single\'\n');
    expect(readEnvFile(tmp)).toEqual({ FOO: 'bar', BAZ: 'quoted value', QUX: 'single' });
  });

  it('upserts without losing other keys', () => {
    fs.writeFileSync(tmp, 'A=1\nB=2\n');
    upsertEnvVar('B', 'updated', tmp);
    upsertEnvVar('C', '3', tmp);
    expect(readEnvFile(tmp)).toEqual({ A: '1', B: 'updated', C: '3' });
  });

  it('writes with 0600 perms', () => {
    upsertEnvVar('SECRET', 'hush', tmp);
    const mode = fs.statSync(tmp).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('loadIntoProcessEnv only fills empty/missing vars', () => {
    fs.writeFileSync(tmp, 'CB_TEST_VAR=fromfile\nCB_TEST_PRESET=fromfile\n');
    process.env.CB_TEST_PRESET = 'already-set';
    const n = loadIntoProcessEnv(tmp);
    expect(n).toBe(1);
    expect(process.env.CB_TEST_VAR).toBe('fromfile');
    expect(process.env.CB_TEST_PRESET).toBe('already-set');
  });
});
