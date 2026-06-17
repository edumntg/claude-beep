import type { Transport, SendTarget, SendResult, ChatMessage } from './types.js';
import { appendDaemonLog } from '../logger.js';

let counter = 0;

export class DryRunTransport implements Transport {
  readonly name = 'dry-run' as const;

  constructor(private readonly impersonates: 'telegram' | 'discord' | 'slack') {}

  async send(target: SendTarget, message: ChatMessage): Promise<SendResult> {
    counter += 1;
    const fakeId = `dry-${counter}`;
    const fields = message.fields.map((f) => `${f.icon} ${f.value}`).join(' | ');
    const excerpt = message.excerpt ? ` | quote: ${message.excerpt.replace(/\n/g, ' ')}` : '';
    const hint = message.hint ? ` | hint: ${message.hint}` : '';
    const line = `[dry-run:${this.impersonates}] -> ${target.id} #${fakeId}\n  ${message.emoji} ${message.title}\n  fields: ${fields}${excerpt}${hint}`;
    appendDaemonLog(line);
    console.log(line);
    return { message_id: fakeId };
  }
}
