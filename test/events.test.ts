import { describe, it, expect } from 'vitest';
import { BaseEventSchema } from '../src/events/schema.js';

describe('BaseEventSchema', () => {
  it('accepts a minimal Stop payload', () => {
    const result = BaseEventSchema.safeParse({
      session_id: 'abc',
      transcript_path: '/tmp/t.jsonl',
      hook_event_name: 'Stop',
    });
    expect(result.success).toBe(true);
  });

  it('preserves unknown fields via passthrough', () => {
    const result = BaseEventSchema.safeParse({ foo: 'bar' });
    expect(result.success).toBe(true);
    if (result.success) expect((result.data as Record<string, unknown>).foo).toBe('bar');
  });
});
