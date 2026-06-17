import type { Transport, SendTarget, SendResult, ChatMessage } from './types.js';

// Telegram's sendMessage hard limit is 4096 characters for the `text` field.
// We leave a small headroom for the truncation marker.
const TELEGRAM_MAX_TEXT = 4096;
const TRUNCATION_SUFFIX = '\n…[truncated]</blockquote>';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderTelegram(msg: ChatMessage): string {
  const lines: string[] = [];
  const titleLine = msg.emoji ? `${msg.emoji} ${msg.title}` : msg.title;
  lines.push(`<b>${escapeHtml(titleLine)}</b>`);

  if (msg.fields.length > 0) {
    lines.push('');
    for (const f of msg.fields) {
      lines.push(`${f.icon} <code>${escapeHtml(f.value)}</code>`);
    }
  }

  if (msg.excerpt) {
    lines.push('');
    lines.push(`<blockquote expandable>${escapeHtml(msg.excerpt)}</blockquote>`);
  }

  if (msg.hint) {
    lines.push('');
    lines.push(`<i>${escapeHtml(msg.hint)}</i>`);
  }

  return lines.join('\n');
}

export function fitTelegramText(text: string, max = TELEGRAM_MAX_TEXT): string {
  if (text.length <= max) return text;
  const budget = max - TRUNCATION_SUFFIX.length;
  return text.slice(0, budget) + TRUNCATION_SUFFIX;
}

interface TelegramSendResponse {
  ok: boolean;
  description?: string;
  result?: { message_id: number };
}

export class TelegramTransport implements Transport {
  readonly name = 'telegram' as const;

  constructor(private readonly token: string) {
    if (!token) throw new Error('TelegramTransport: bot token is empty');
  }

  async send(target: SendTarget, message: ChatMessage): Promise<SendResult> {
    if (!target.id) throw new Error('telegram: missing chat_id');

    const text = fitTelegramText(renderTelegram(message));
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: target.id,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>');
      throw new Error(`telegram send failed: ${res.status} ${body}`);
    }

    const json = (await res.json().catch(() => ({ ok: false }))) as TelegramSendResponse;
    if (!json.ok || !json.result) {
      throw new Error(`telegram send rejected: ${json.description ?? 'unknown'}`);
    }
    return { message_id: String(json.result.message_id) };
  }
}
