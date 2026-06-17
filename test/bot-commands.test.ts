import { describe, it, expect } from 'vitest';
import {
  parseBotCommand,
  buildSessionsReply,
  buildStatusReply,
  buildHelpReply,
} from '../src/bot-commands.js';
import type { SessionHandle } from '../src/ipc/server.js';

const fakeHandle = (over: Partial<SessionHandle>): SessionHandle => ({
  session_id: over.session_id ?? '00000000-aaaa-bbbb-cccc-dddddddddddd',
  pid: over.pid ?? 1000,
  cwd: over.cwd ?? '/tmp',
  name: over.name,
  inject: () => {},
  close: () => {},
});

describe('parseBotCommand', () => {
  it('parses /sessions', () => {
    expect(parseBotCommand('/sessions')).toEqual({ name: 'sessions', args: '' });
  });

  it('parses aliases /ls and /sess', () => {
    expect(parseBotCommand('/ls')?.name).toBe('sessions');
    expect(parseBotCommand('/sess')?.name).toBe('sessions');
  });

  it('parses /status and aliases', () => {
    expect(parseBotCommand('/status')?.name).toBe('status');
    expect(parseBotCommand('/s')?.name).toBe('status');
    expect(parseBotCommand('/info')?.name).toBe('status');
  });

  it('parses /help', () => {
    expect(parseBotCommand('/help')?.name).toBe('help');
  });

  it('ignores leading whitespace', () => {
    expect(parseBotCommand('   /sessions  ')?.name).toBe('sessions');
  });

  it('is case-insensitive on the verb', () => {
    expect(parseBotCommand('/STATUS')?.name).toBe('status');
  });

  it('returns undefined for non-command text', () => {
    expect(parseBotCommand('@api hello')).toBeUndefined();
    expect(parseBotCommand('just a message')).toBeUndefined();
    expect(parseBotCommand('/unknownThing')).toBeUndefined();
  });
});

describe('buildSessionsReply', () => {
  it('shows the empty-state message when no sessions', () => {
    const msg = buildSessionsReply([]);
    expect(msg.title).toBe('No active sessions');
    expect(msg.excerpt).toContain('claude-beep run --name');
  });

  it('lists named and unnamed sessions', () => {
    const msg = buildSessionsReply([
      fakeHandle({ name: 'api', cwd: '/srv/work/api', pid: 100 }),
      fakeHandle({ session_id: 'abcdef1234567890', cwd: '/srv/other', pid: 200 }),
    ]);
    expect(msg.title).toBe('2 active sessions');
    expect(msg.excerpt).toContain('@api');
    expect(msg.excerpt).toContain('/srv/work/api');
    expect(msg.excerpt).toContain('pid 100');
    expect(msg.excerpt).toContain('abcdef12');
    expect(msg.hint).toMatch(/@<name>/);
  });

  it('uses singular wording when there is one session', () => {
    expect(buildSessionsReply([fakeHandle({ name: 'solo' })]).title).toBe('1 active session');
  });
});

describe('buildStatusReply', () => {
  it('builds field rows from daemon state', () => {
    const msg = buildStatusReply(
      {
        pid: 1234,
        startedAt: Date.now() - 5000,
        outbound: ['telegram'],
        inbound: ['telegram'],
        eventsSeen: 7,
      },
      3,
    );
    expect(msg.title).toBe('Daemon status');
    const labels = msg.fields.map((f) => f.label);
    expect(labels).toContain('PID');
    expect(labels).toContain('Uptime');
    expect(labels).toContain('Outbound');
    expect(labels).toContain('Sessions');
    const sessionsField = msg.fields.find((f) => f.label === 'Sessions');
    expect(sessionsField?.value).toBe('3');
  });
});

describe('buildHelpReply', () => {
  it('lists the three commands', () => {
    const msg = buildHelpReply();
    expect(msg.excerpt).toContain('/sessions');
    expect(msg.excerpt).toContain('/status');
    expect(msg.excerpt).toContain('/help');
    expect(msg.excerpt).toContain('@<name>');
  });
});
