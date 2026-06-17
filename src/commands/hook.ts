import { sendToDaemon } from '../ipc/client.js';
import { appendEventLog } from '../logger.js';
import { BaseEventSchema, NormalizedEvent } from '../events/schema.js';

const EVENT_ALIASES: Record<string, string> = {
  stop: 'stop',
  notification: 'notification',
  subagentstop: 'subagent-stop',
  'subagent-stop': 'subagent-stop',
  userpromptsubmit: 'user-prompt-submit',
  'user-prompt-submit': 'user-prompt-submit',
  precompact: 'pre-compact',
  'pre-compact': 'pre-compact',
  sessionstart: 'session-start',
  'session-start': 'session-start',
};

function normalizeEventType(raw: string): string {
  const lower = raw.toLowerCase();
  return EVENT_ALIASES[lower] ?? lower;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
  });
}

export async function hookCommand(event: string): Promise<void> {
  const raw = await readStdin();
  let parsed: unknown = {};
  if (raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { _raw: raw };
    }
  }
  const validated = BaseEventSchema.safeParse(parsed);
  const normalized: NormalizedEvent = {
    event_type: normalizeEventType(event),
    received_at: Date.now(),
    raw: validated.success ? validated.data : (parsed as Record<string, unknown>),
    wrapper_id: process.env.CLAUDE_BEEP_WRAPPER_ID,
    session_name: process.env.CLAUDE_BEEP_SESSION_NAME,
  };

  appendEventLog(normalized);
  await sendToDaemon({ type: 'event', payload: normalized });

  process.exit(0);
}
