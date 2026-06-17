import type { Config } from '../config/loader.js';
import type { Transport } from './types.js';
import { TelegramTransport } from './telegram.js';
import { DryRunTransport } from './dry-run.js';
import { DiscordTransport } from './discord.js';
import { SlackTransport } from './slack.js';

export interface BuildOptions {
  dryRun?: boolean;
}

export interface TransportTargets {
  telegram?: { default_chat_id?: string };
  discord?: { default_channel_id?: string };
  slack?: { default_channel_id?: string };
}

export interface BuiltTransports {
  byName: Map<'telegram' | 'discord' | 'slack', Transport>;
  defaults: TransportTargets;
}

export function buildTransports(config: Config, opts: BuildOptions = {}): BuiltTransports {
  const byName = new Map<'telegram' | 'discord' | 'slack', Transport>();
  const defaults: TransportTargets = {};

  if (config.transports.telegram) {
    const token = process.env[config.transports.telegram.bot_token_env] ?? '';
    defaults.telegram = { default_chat_id: config.transports.telegram.default_chat_id };
    if (opts.dryRun) {
      byName.set('telegram', new DryRunTransport('telegram'));
    } else if (token) {
      byName.set('telegram', new TelegramTransport(token));
    }
  }

  if (config.transports.discord) {
    const token = process.env[config.transports.discord.bot_token_env] ?? '';
    defaults.discord = { default_channel_id: config.transports.discord.default_channel_id };
    if (opts.dryRun) {
      byName.set('discord', new DryRunTransport('discord'));
    } else if (token) {
      byName.set('discord', new DiscordTransport(token));
    }
  }

  if (config.transports.slack) {
    const botToken = process.env[config.transports.slack.bot_token_env] ?? '';
    defaults.slack = { default_channel_id: config.transports.slack.default_channel_id };
    if (opts.dryRun) {
      byName.set('slack', new DryRunTransport('slack'));
    } else if (botToken) {
      byName.set('slack', new SlackTransport(botToken));
    }
  }

  return { byName, defaults };
}
