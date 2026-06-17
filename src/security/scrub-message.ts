import { scrub, type ScrubberOptions } from './scrubber.js';
import type { ChatMessage } from '../transports/types.js';

export function scrubChatMessage(msg: ChatMessage, opts: ScrubberOptions): ChatMessage {
  return {
    ...msg,
    title: scrub(msg.title, opts),
    fields: msg.fields.map((f) => ({ ...f, value: scrub(f.value, opts) })),
    excerpt: msg.excerpt ? scrub(msg.excerpt, opts) : undefined,
    hint: msg.hint ? scrub(msg.hint, opts) : undefined,
  };
}
