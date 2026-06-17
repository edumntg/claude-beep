import type { Config } from '../../config/loader.js';
import type { InboundTransport } from './types.js';
import { TelegramInbound } from './telegram.js';
import { DiscordInbound } from './discord.js';
import { SlackInbound } from './slack.js';

export function buildInboundTransports(config: Config): InboundTransport[] {
  const transports: InboundTransport[] = [];

  if (config.transports.telegram) {
    const token = process.env[config.transports.telegram.bot_token_env];
    const senders = config.transports.telegram.allowed_senders;
    if (token && senders.length > 0) {
      transports.push(new TelegramInbound(token, senders));
    }
  }

  if (config.transports.discord) {
    const token = process.env[config.transports.discord.bot_token_env];
    const senders = config.transports.discord.allowed_senders;
    if (token && senders.length > 0) {
      transports.push(new DiscordInbound(token, senders));
    }
  }

  if (config.transports.slack) {
    const appToken = process.env[config.transports.slack.app_token_env];
    const senders = config.transports.slack.allowed_senders;
    if (appToken && senders.length > 0) {
      transports.push(new SlackInbound(appToken, senders));
    }
  }

  return transports;
}
