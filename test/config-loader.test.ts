import { describe, it, expect } from 'vitest';
import { parseConfig, ConfigSchema } from '../src/config/loader.js';

describe('parseConfig', () => {
  it('parses the default YAML shape', () => {
    const yaml = `
default_transport: telegram
transports:
  telegram:
    bot_token_env: TELEGRAM_BOT_TOKEN
    default_chat_id: "123"
routing:
  - match: { cwd: "**" }
    transport: telegram
filters:
  min_turn_seconds: 30
  notify_on_error: true
  quiet_hours: ["23:00", "07:00"]
`;
    const config = parseConfig(yaml);
    expect(config.default_transport).toBe('telegram');
    expect(config.transports.telegram?.default_chat_id).toBe('123');
    expect(config.routing).toHaveLength(1);
    expect(config.filters.min_turn_seconds).toBe(30);
    expect(config.filters.quiet_hours).toEqual(['23:00', '07:00']);
  });

  it('applies defaults for missing fields', () => {
    const config = ConfigSchema.parse({});
    expect(config.default_transport).toBe('telegram');
    expect(config.routing).toEqual([]);
    expect(config.filters.notify_on_error).toBe(true);
  });

  it('rejects unknown transports', () => {
    expect(() =>
      ConfigSchema.parse({
        routing: [{ match: { cwd: '**' }, transport: 'sms' }],
      }),
    ).toThrow();
  });
});
