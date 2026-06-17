import { Client, GatewayIntentBits, Events } from 'discord.js';
import type { InboundTransport, InboundHandler } from './types.js';

export class DiscordInbound implements InboundTransport {
  readonly name = 'discord' as const;
  private readonly client: Client;
  private readonly allowed: Set<string>;

  constructor(private readonly token: string, allowedSenders: string[]) {
    this.allowed = new Set(allowedSenders);
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });
  }

  async start(onMessage: InboundHandler): Promise<void> {
    this.client.on(Events.MessageCreate, async (msg) => {
      if (msg.author.bot) return;
      if (!this.allowed.has(msg.author.id)) return;
      const text = msg.content?.trim();
      if (!text) return;
      await onMessage({
        transport: 'discord',
        sender_id: msg.author.id,
        channel_id: msg.channelId,
        text,
        reply_to_message_id: msg.reference?.messageId ?? undefined,
      });
    });
    await this.client.login(this.token);
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }
}
