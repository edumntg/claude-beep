import type { Transport, SendTarget, SendResult, ChatMessage } from './types.js';

const API = 'https://slack.com/api';

interface SlackResponse {
  ok: boolean;
  error?: string;
  ts?: string;
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: Array<{ type: string; text: string }>;
  fields?: Array<{ type: string; text: string }>;
}

export function renderSlackBlocks(msg: ChatMessage): { text: string; blocks: SlackBlock[] } {
  const titleLine = msg.emoji ? `${msg.emoji} ${msg.title}` : msg.title;
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: titleLine.slice(0, 150), emoji: true },
    },
  ];

  if (msg.fields.length > 0) {
    blocks.push({
      type: 'section',
      fields: msg.fields.slice(0, 10).map((f) => ({
        type: 'mrkdwn',
        text: `${f.icon} *${f.label}*\n\`${f.value}\``,
      })),
    });
  }

  if (msg.excerpt) {
    const quoted = msg.excerpt
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: quoted.slice(0, 2900) || ' ' },
    });
  }

  if (msg.hint) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `_${msg.hint}_` }],
    });
  }

  return { text: titleLine, blocks };
}

export class SlackTransport implements Transport {
  readonly name = 'slack' as const;

  constructor(private readonly botToken: string) {
    if (!botToken) throw new Error('SlackTransport: bot token is empty');
  }

  async send(target: SendTarget, message: ChatMessage): Promise<SendResult> {
    if (!target.id) throw new Error('slack: missing channel_id');

    const { text, blocks } = renderSlackBlocks(message);

    const res = await fetch(`${API}/chat.postMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${this.botToken}`,
      },
      body: JSON.stringify({
        channel: target.id,
        text,
        blocks,
      }),
    });

    const json = (await res.json().catch(() => ({ ok: false, error: 'invalid json' }))) as SlackResponse;
    if (!res.ok || !json.ok) {
      throw new Error(`slack send failed: status=${res.status} error=${json.error ?? 'unknown'}`);
    }
    return { message_id: json.ts };
  }
}
