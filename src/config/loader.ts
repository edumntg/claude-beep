import fs from 'node:fs';
import YAML from 'yaml';
import { z } from 'zod';
import { CONFIG_FILE } from './paths.js';

const TelegramTransportSchema = z.object({
  bot_token_env: z.string(),
  default_chat_id: z.string().optional().default(''),
  allowed_senders: z.array(z.string()).default([]),
});

const DiscordTransportSchema = z.object({
  bot_token_env: z.string(),
  default_channel_id: z.string().optional().default(''),
  allowed_senders: z.array(z.string()).default([]),
});

const SlackTransportSchema = z.object({
  app_token_env: z.string(),
  bot_token_env: z.string(),
  default_channel_id: z.string().optional().default(''),
  allowed_senders: z.array(z.string()).default([]),
});

export const RouteSchema = z.object({
  match: z.object({
    cwd: z.string().optional(),
    session_name: z.string().optional(),
  }),
  transport: z.enum(['telegram', 'discord', 'slack']),
  chat_id: z.string().optional(),
  channel_id: z.string().optional(),
});

export const FiltersSchema = z.object({
  min_turn_seconds: z.number().nonnegative().default(0),
  notify_on_error: z.boolean().default(true),
  quiet_hours: z.array(z.string()).default([]),
  // Which event types result in a chat notification. Default: stop + subagent-stop
  // (subagent-finished pings are useful when you've delegated work). Notification
  // events (permission prompts) are suppressed by default because they're noisy.
  notify_event_types: z
    .array(z.enum(['stop', 'notification', 'subagent-stop']))
    .default(['stop', 'subagent-stop']),
});

export const SecuritySchema = z.object({
  scrub_tokens: z.boolean().default(true),
  scrub_extra_patterns: z.array(z.string()).default([]),
  sensitive_paths: z
    .array(z.string())
    .default([
      '**/.env',
      '**/.env.*',
      '**/credentials/**',
      '**/secrets/**',
      '**/*.pem',
      '**/*.key',
    ]),
});

export const PastebinSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(['dpaste', 'gist']).default('dpaste'),
  threshold_chars: z.number().int().positive().default(1000),
  preview_chars: z.number().int().positive().default(400),
  dpaste: z
    .object({
      expiry_days: z.number().int().positive().default(30),
      syntax: z.string().default('markdown'),
    })
    .default({}),
  gist: z
    .object({
      token_env: z.string().default('GITHUB_TOKEN'),
      public: z.boolean().default(false),
    })
    .default({}),
});

export const ConfigSchema = z.object({
  default_transport: z.enum(['telegram', 'discord', 'slack']).default('telegram'),
  transports: z
    .object({
      telegram: TelegramTransportSchema.optional(),
      discord: DiscordTransportSchema.optional(),
      slack: SlackTransportSchema.optional(),
    })
    .default({}),
  routing: z.array(RouteSchema).default([]),
  filters: FiltersSchema.default({}),
  security: SecuritySchema.default({}),
  pastebin: PastebinSchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type Route = z.infer<typeof RouteSchema>;
export type Filters = z.infer<typeof FiltersSchema>;
export type Security = z.infer<typeof SecuritySchema>;
export type Pastebin = z.infer<typeof PastebinSchema>;

export function parseConfig(yamlText: string): Config {
  const raw = YAML.parse(yamlText) ?? {};
  return ConfigSchema.parse(raw);
}

export async function loadConfig(path: string = CONFIG_FILE): Promise<Config> {
  if (!fs.existsSync(path)) {
    return ConfigSchema.parse({});
  }
  const text = await fs.promises.readFile(path, 'utf8');
  return parseConfig(text);
}
