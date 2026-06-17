import type { Transport, SendTarget, SendResult, ChatMessage } from './types.js';

const API = 'https://discord.com/api/v10';

export function renderDiscord(msg: ChatMessage): string {
  const lines: string[] = [];
  const titleLine = msg.emoji ? `${msg.emoji} ${msg.title}` : msg.title;
  lines.push(`**${titleLine}**`);

  if (msg.fields.length > 0) {
    lines.push('');
    for (const f of msg.fields) {
      lines.push(`${f.icon} \`${f.value}\``);
    }
  }

  if (msg.excerpt) {
    lines.push('');
    const quoted = msg.excerpt
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n');
    lines.push(quoted);
  }

  if (msg.hint) {
    lines.push('');
    lines.push(`_${msg.hint}_`);
  }

  return lines.join('\n');
}

interface DiscordSendResponse {
  id?: string;
  code?: number;
  message?: string;
}

export class DiscordTransport implements Transport {
  readonly name = 'discord' as const;

  constructor(private readonly botToken: string) {
    if (!botToken) throw new Error('DiscordTransport: bot token is empty');
  }

  async send(target: SendTarget, message: ChatMessage): Promise<SendResult> {
    if (!target.id) throw new Error('discord: missing channel_id');

    let content = renderDiscord(message);
    if (content.length > 1990) content = content.slice(0, 1990) + '…';

    const res = await fetch(`${API}/channels/${encodeURIComponent(target.id)}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${this.botToken}`,
      },
      body: JSON.stringify({
        content,
        allowed_mentions: { parse: [] },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>');
      throw new Error(`discord send failed: ${res.status} ${body}`);
    }
    const json = (await res.json().catch(() => ({}))) as DiscordSendResponse;
    return { message_id: json.id };
  }
}
