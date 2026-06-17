import type { InboundTransport, InboundHandler } from './types.js';

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    from?: { id?: number };
    chat?: { id?: number };
    reply_to_message?: { message_id?: number };
  };
}

interface TelegramResponse {
  ok: boolean;
  result?: TelegramUpdate[];
  description?: string;
}

export class TelegramInbound implements InboundTransport {
  readonly name = 'telegram' as const;
  private offset = 0;
  private stopped = false;
  private readonly allowed: Set<string>;
  private abort?: AbortController;

  constructor(private readonly token: string, allowedSenders: string[]) {
    this.allowed = new Set(allowedSenders);
  }

  async start(onMessage: InboundHandler): Promise<void> {
    this.stopped = false;
    void this.loop(onMessage);
  }

  private async loop(onMessage: InboundHandler): Promise<void> {
    while (!this.stopped) {
      try {
        this.abort = new AbortController();
        const url = `https://api.telegram.org/bot${this.token}/getUpdates?timeout=30&offset=${this.offset}`;
        const res = await fetch(url, { signal: this.abort.signal });
        const data = (await res.json()) as TelegramResponse;
        if (!data.ok || !Array.isArray(data.result)) {
          await sleep(2000, this.abort.signal);
          continue;
        }
        for (const update of data.result) {
          this.offset = update.update_id + 1;
          const m = update.message;
          if (!m?.text || !m.from?.id || !m.chat?.id) continue;
          const senderId = String(m.from.id);
          if (!this.allowed.has(senderId)) continue;
          await onMessage({
            transport: 'telegram',
            sender_id: senderId,
            channel_id: String(m.chat.id),
            text: m.text,
            reply_to_message_id: m.reply_to_message?.message_id
              ? String(m.reply_to_message.message_id)
              : undefined,
          });
        }
      } catch (err) {
        if (this.stopped) break;
        await sleep(2000);
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abort?.abort();
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });
}
