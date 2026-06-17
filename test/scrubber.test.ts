import { describe, it, expect } from 'vitest';
import { scrub } from '../src/security/scrubber.js';

const opts = { enabled: true, extra_patterns: [] as string[] };

describe('scrub', () => {
  it('redacts Bearer tokens', () => {
    const out = scrub('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.xxxxxxx.yyyyyyy', opts);
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts GitHub tokens', () => {
    const out = scrub('GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789', opts);
    expect(out).not.toContain('ghp_abcdefghij');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts OpenAI keys', () => {
    const out = scrub('using sk-1234567890abcdef1234567890abcdef for the call', opts);
    expect(out).not.toContain('sk-1234567890');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts Slack tokens', () => {
    const out = scrub('SLACK_BOT_TOKEN=xoxb-12345-67890-aBcDeFgHiJkLmNoP', opts);
    expect(out).not.toContain('xoxb-12345');
  });

  it('redacts AWS access keys', () => {
    expect(scrub('aws key AKIAIOSFODNN7EXAMPLE here', opts)).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('redacts KEY=VALUE for *_TOKEN / *_KEY / *_SECRET / *_PASSWORD', () => {
    const cases = [
      'MY_API_TOKEN=hunter2hunter2',
      'DATABASE_PASSWORD="correct horse battery"',
      'STRIPE_SECRET=sk_test_abcdefg123',
      'CUSTOM_API_KEY: abcdef12345',
    ];
    for (const c of cases) {
      const out = scrub(c, opts);
      expect(out).toContain('=[REDACTED]');
    }
  });

  it('applies extra_patterns', () => {
    const out = scrub('myCustomSecretXYZ-1234', { enabled: true, extra_patterns: ['myCustomSecretXYZ-\\d+'] });
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('myCustomSecretXYZ-1234');
  });

  it('does nothing when disabled', () => {
    const text = 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    expect(scrub(text, { enabled: false, extra_patterns: [] })).toBe(text);
  });

  it('ignores malformed extra regex', () => {
    expect(() => scrub('hello', { enabled: true, extra_patterns: ['['] })).not.toThrow();
  });
});
