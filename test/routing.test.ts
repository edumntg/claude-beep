import { describe, it, expect } from 'vitest';
import { globMatch, pickRoute, resolveTargetId } from '../src/routing.js';
import { ConfigSchema } from '../src/config/loader.js';

describe('globMatch', () => {
  it('matches "**" against anything', () => {
    expect(globMatch('**', '/any/path')).toBe(true);
    expect(globMatch('**', '/')).toBe(true);
  });

  it('matches a single-segment "*" only within one path segment', () => {
    expect(globMatch('/a/*', '/a/b')).toBe(true);
    expect(globMatch('/a/*', '/a/b/c')).toBe(false);
  });

  it('matches "**" across segments', () => {
    expect(globMatch('/a/**', '/a/b/c')).toBe(true);
    expect(globMatch('/a/**', '/a')).toBe(false);
    expect(globMatch('/a/**', '/a/')).toBe(true);
  });
});

describe('pickRoute', () => {
  const config = ConfigSchema.parse({
    default_transport: 'telegram',
    transports: {
      telegram: { bot_token_env: 'TG', default_chat_id: '999' },
      discord: { bot_token_env: 'DC', default_channel_id: 'C999' },
    },
    routing: [
      { match: { cwd: '/work/**' }, transport: 'discord', channel_id: 'C123' },
      { match: { cwd: '**' }, transport: 'telegram' },
    ],
  });

  it('picks discord for /work/**', () => {
    const route = pickRoute(config, { cwd: '/work/repo' });
    expect(route?.transport).toBe('discord');
    expect(resolveTargetId(config, route!)).toBe('C123');
  });

  it('falls back to the catch-all', () => {
    const route = pickRoute(config, { cwd: '/elsewhere' });
    expect(route?.transport).toBe('telegram');
    expect(resolveTargetId(config, route!)).toBe('999');
  });

  it('returns undefined if no route matches', () => {
    const narrow = ConfigSchema.parse({
      routing: [{ match: { cwd: '/x/**' }, transport: 'telegram' }],
      transports: { telegram: { bot_token_env: 'TG' } },
    });
    expect(pickRoute(narrow, { cwd: '/y' })).toBeUndefined();
  });
});
