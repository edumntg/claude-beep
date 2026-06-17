import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelegramInbound } from '../src/transports/inbound/telegram.js';
import type { InboundMessage } from '../src/transports/inbound/types.js';

describe('TelegramInbound allowlist', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            result: [
              {
                update_id: 100,
                message: {
                  text: 'allowed message',
                  from: { id: 111 },
                  chat: { id: 999 },
                },
              },
              {
                update_id: 101,
                message: {
                  text: 'blocked message',
                  from: { id: 222 },
                  chat: { id: 999 },
                },
              },
            ],
          }),
        } as Response;
      }
      // hang forever on subsequent calls so the test ends cleanly via stop()
      return new Promise<Response>(() => {});
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('filters senders not in the allowlist', async () => {
    const got: InboundMessage[] = [];
    const inbound = new TelegramInbound('TEST_TOKEN', ['111']);
    await inbound.start(async (msg) => {
      got.push(msg);
    });
    await new Promise((r) => setTimeout(r, 60));
    await inbound.stop();
    expect(got.map((m) => m.sender_id)).toEqual(['111']);
    expect(got[0].text).toBe('allowed message');
  });
});
