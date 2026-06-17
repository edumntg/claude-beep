import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { formatEvent, makeSessionLabel } from '../src/format.js';
import { renderTelegram } from '../src/transports/telegram.js';

describe('formatEvent', () => {
  it('produces a Stop-event message with duration, project, and session label', async () => {
    const msg = await formatEvent(
      {
        event_type: 'stop',
        received_at: Date.now(),
        raw: { session_id: 'abcdefgh1234', cwd: '/Users/x/proj' },
      },
      { duration_seconds: 12.5 },
    );
    expect(msg.emoji).toBe('✅');
    expect(msg.title).toContain('Claude finished');
    expect(msg.title).toContain('proj');
    expect(msg.title).toContain('12.5s');
    expect(msg.fields.map((f) => f.label)).toContain('Project');
    expect(msg.fields.map((f) => f.label)).toContain('Duration');
    expect(msg.fields.map((f) => f.label)).toContain('Session');
    expect(msg.session_label).toMatch(/^proj-/);
    expect(msg.hint).toMatch(/Reply to this message/);
  });

  it('produces a Notification message and surfaces the message field', async () => {
    const msg = await formatEvent(
      {
        event_type: 'notification',
        received_at: Date.now(),
        raw: { session_id: 's', cwd: '/x', message: 'Permission needed for Bash' },
      },
      {},
    );
    expect(msg.emoji).toBe('⏸');
    expect(msg.title).toContain('Claude needs input');
    expect(msg.excerpt).toBe('Permission needed for Bash');
  });

  it('extracts the last assistant text from a transcript for Stop events', async () => {
    const tmp = path.join(os.tmpdir(), `cb-test-${Date.now()}.jsonl`);
    fs.writeFileSync(
      tmp,
      [
        JSON.stringify({ type: 'user', message: { content: 'hi' } }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Done with the refactor.' }] },
        }),
      ].join('\n'),
    );
    const msg = await formatEvent(
      {
        event_type: 'stop',
        received_at: Date.now(),
        raw: { session_id: 's', cwd: '/x', transcript_path: tmp },
      },
      { duration_seconds: 3 },
    );
    expect(msg.excerpt).toContain('Done with the refactor.');
    fs.unlinkSync(tmp);
  });

  it('formats long durations as Xm Ys', async () => {
    const msg = await formatEvent(
      { event_type: 'stop', received_at: 0, raw: { cwd: '/x' } },
      { duration_seconds: 125 },
    );
    expect(msg.title).toContain('2m 5s');
  });
});

describe('makeSessionLabel', () => {
  it('combines cwd basename with a short uuid prefix', () => {
    expect(makeSessionLabel('/Users/x/api', 'abcdef12-1234-5678-9abc-def012345678')).toBe('api-abcd');
  });
  it('handles dashless ids', () => {
    expect(makeSessionLabel('/repo/foo', 'XYZ')).toBe('foo-XYZ');
  });
  it('falls back to "session" when cwd has no basename', () => {
    expect(makeSessionLabel('/', 'abcd1234')).toBe('session-abcd');
  });
});

describe('renderTelegram', () => {
  it('produces HTML with bold title and code-wrapped fields', () => {
    const out = renderTelegram({
      title: 'Claude finished · proj · 5s',
      emoji: '✅',
      fields: [
        { icon: '📁', label: 'Project', value: '/Users/x/proj' },
        { icon: '🔖', label: 'Session', value: 'proj-abcd' },
      ],
      excerpt: 'Refactor done.',
      hint: 'Reply to route.',
    });
    expect(out).toContain('<b>✅ Claude finished');
    expect(out).toContain('📁 <code>/Users/x/proj</code>');
    expect(out).toContain('<blockquote');
    expect(out).toContain('<i>Reply to route.</i>');
  });

  it('escapes HTML special chars in user-controlled strings', () => {
    const out = renderTelegram({
      title: 'a < b & c > d',
      emoji: '🔔',
      fields: [{ icon: '📁', label: 'p', value: '<script>' }],
    });
    expect(out).toContain('a &lt; b &amp; c &gt; d');
    expect(out).toContain('&lt;script&gt;');
  });
});
