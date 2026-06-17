import { SocketModeClient } from '@slack/socket-mode';
import type { InboundTransport, InboundHandler } from './types.js';

interface SlackMessageEvent {
  type: string;
  subtype?: string;
  user?: string;
  text?: string;
  channel?: string;
  bot_id?: string;
  thread_ts?: string;
  ts?: string;
}

export class SlackInbound implements InboundTransport {
  readonly name = 'slack' as const;
  private readonly client: SocketModeClient;
  private readonly allowed: Set<string>;

  constructor(appToken: string, allowedSenders: string[]) {
    this.allowed = new Set(allowedSenders);
    this.client = new SocketModeClient({ appToken });
  }

  async start(onMessage: InboundHandler): Promise<void> {
    this.client.on('message', async ({ event, ack }: { event: SlackMessageEvent; ack: () => Promise<void> }) => {
      await ack();
      if (event.subtype || event.bot_id) return;
      const senderId = event.user;
      if (!senderId || !this.allowed.has(senderId)) return;
      const text = event.text?.trim();
      if (!text || !event.channel) return;
      await onMessage({
        transport: 'slack',
        sender_id: senderId,
        channel_id: event.channel,
        text,
        // In Slack a "reply" is a threaded reply; the parent message ts is in thread_ts.
        reply_to_message_id: event.thread_ts && event.thread_ts !== event.ts ? event.thread_ts : undefined,
      });
    });
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.disconnect();
  }
}
