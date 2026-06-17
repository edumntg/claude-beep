import { describe, it, expect } from 'vitest';
import { renderTelegram, fitTelegramText } from '../src/transports/telegram.js';
import type { ChatMessage } from '../src/transports/types.js';

describe('renderTelegram', () => {
  it('renders title, fields, excerpt, and hint as HTML', () => {
    const msg: ChatMessage = {
      title: 'Claude finished · proj',
      emoji: '✅',
      fields: [{ icon: '📁', label: 'Project', value: '~/p' }],
      excerpt: 'hello <world>',
      hint: 'reply to route',
    };
    const out = renderTelegram(msg);
    expect(out).toContain('<b>✅ Claude finished · proj</b>');
    expect(out).toContain('📁 <code>~/p</code>');
    expect(out).toContain('<blockquote expandable>hello &lt;world&gt;</blockquote>');
    expect(out).toContain('<i>reply to route</i>');
  });
});

describe('fitTelegramText', () => {
  it('returns short input unchanged', () => {
    expect(fitTelegramText('hello', 100)).toBe('hello');
  });

  it('truncates oversized input and appends a marker that closes the blockquote', () => {
    const huge = 'a'.repeat(10_000);
    const fitted = fitTelegramText(huge, 4096);
    expect(fitted.length).toBeLessThanOrEqual(4096);
    expect(fitted.endsWith('\n…[truncated]</blockquote>')).toBe(true);
  });

  it('keeps rendered messages under the Telegram 4096-char ceiling', () => {
    const msg: ChatMessage = {
      title: 'Claude finished · proj',
      emoji: '✅',
      fields: [
        { icon: '📁', label: 'Project', value: '~/some/very/long/path' },
        { icon: '🔖', label: 'Session', value: 'internalprototypes' },
      ],
      excerpt: 'x'.repeat(8000),
      hint: 'reply to route your response',
    };
    const fitted = fitTelegramText(renderTelegram(msg));
    expect(fitted.length).toBeLessThanOrEqual(4096);
  });
});
