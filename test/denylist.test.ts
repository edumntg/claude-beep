import { describe, it, expect } from 'vitest';
import { isSensitivePath, DEFAULT_SENSITIVE_PATHS } from '../src/security/denylist.js';

describe('isSensitivePath', () => {
  it('flags .env files', () => {
    expect(isSensitivePath('/Users/x/proj/.env', DEFAULT_SENSITIVE_PATHS)).toBe(true);
    expect(isSensitivePath('/Users/x/proj/.env.production', DEFAULT_SENSITIVE_PATHS)).toBe(true);
  });

  it('flags credentials and secrets dirs', () => {
    expect(isSensitivePath('/repo/credentials/aws', DEFAULT_SENSITIVE_PATHS)).toBe(true);
    expect(isSensitivePath('/srv/app/secrets/api', DEFAULT_SENSITIVE_PATHS)).toBe(true);
  });

  it('flags key material files', () => {
    expect(isSensitivePath('/home/u/keys/id_rsa.pem', DEFAULT_SENSITIVE_PATHS)).toBe(true);
    expect(isSensitivePath('/etc/ssl/server.key', DEFAULT_SENSITIVE_PATHS)).toBe(true);
  });

  it('does not flag normal project directories', () => {
    expect(isSensitivePath('/Users/x/work/app', DEFAULT_SENSITIVE_PATHS)).toBe(false);
    expect(isSensitivePath('/repo/src/components', DEFAULT_SENSITIVE_PATHS)).toBe(false);
  });

  it('returns false when cwd is missing', () => {
    expect(isSensitivePath(undefined, DEFAULT_SENSITIVE_PATHS)).toBe(false);
  });

  it('respects custom denylist (default is not applied)', () => {
    expect(isSensitivePath('/repo/special', ['**/special'])).toBe(true);
    expect(isSensitivePath('/repo/special', [])).toBe(false);
  });
});
