import path from 'node:path';
import os from 'node:os';
import type { NormalizedEvent } from './events/schema.js';
import { lastAssistantText } from './transcript.js';
import type { ChatMessage, MessageField } from './transports/types.js';

// Excerpt is left untrimmed here; the daemon decides whether to paste it to a
// pastebin or hard-truncate it before sending.
const EXCERPT_HARD_CAP = 4000;

export interface FormatContext {
  duration_seconds?: number;
}

export async function formatEvent(event: NormalizedEvent, ctx: FormatContext = {}): Promise<ChatMessage> {
  const cwd = event.raw.cwd ?? 'unknown';
  const sessionId = event.raw.session_id ?? event.wrapper_id ?? 'unknown';
  const project = prettyCwd(cwd);
  const projectLabel = path.basename(cwd) || project;
  const sessionLabel = event.session_name ?? makeSessionLabel(cwd, event.wrapper_id ?? sessionId);

  const emoji = emojiFor(event.event_type);
  const title = titleFor(event.event_type, ctx.duration_seconds, projectLabel);

  const fields: MessageField[] = [
    { icon: '📁', label: 'Project', value: project },
    { icon: '🔖', label: 'Session', value: sessionLabel },
  ];
  if (ctx.duration_seconds !== undefined) {
    fields.splice(1, 0, {
      icon: '⏱',
      label: 'Duration',
      value: formatDuration(ctx.duration_seconds),
    });
  }

  let excerpt: string | undefined;
  const noticeMessage = (event.raw as Record<string, unknown>).message;
  if (typeof noticeMessage === 'string' && noticeMessage.trim()) {
    excerpt = noticeMessage.trim();
  } else if (event.event_type === 'stop' && event.raw.transcript_path) {
    const tail = await lastAssistantText(event.raw.transcript_path);
    if (tail) excerpt = tail;
  }
  // Safety cap to protect against pathological transcripts. The pastebin layer
  // in the daemon handles "long but reasonable" excerpts before this kicks in.
  if (excerpt && excerpt.length > EXCERPT_HARD_CAP) {
    excerpt = excerpt.slice(0, EXCERPT_HARD_CAP) + '…';
  }

  const hint = hintFor(event.event_type, event.session_name);

  return {
    title,
    emoji,
    fields,
    excerpt,
    hint,
    session_id: sessionId,
    session_label: sessionLabel,
    cwd,
    event_type: event.event_type,
  };
}

export function makeSessionLabel(cwd: string, sessionId: string): string {
  const base = path.basename(cwd) || 'session';
  const short = sessionId.replace(/-/g, '').slice(0, 4) || '????';
  return `${base}-${short}`;
}

function prettyCwd(cwd: string): string {
  const home = os.homedir();
  if (cwd === home) return '~';
  if (cwd.startsWith(home + path.sep)) return '~' + cwd.slice(home.length);
  return cwd;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function emojiFor(eventType: string): string {
  switch (eventType) {
    case 'stop': return '✅';
    case 'notification': return '⏸';
    case 'subagent-stop': return '🤖';
    case 'user-prompt-submit': return '▶️';
    default: return '🔔';
  }
}

function titleFor(eventType: string, durationSec: number | undefined, projectLabel: string): string {
  switch (eventType) {
    case 'stop':
      return durationSec !== undefined
        ? `Claude finished · ${projectLabel} · ${formatDuration(durationSec)}`
        : `Claude finished · ${projectLabel}`;
    case 'notification':
      return `Claude needs input · ${projectLabel}`;
    case 'subagent-stop':
      return `Subagent finished · ${projectLabel}`;
    case 'user-prompt-submit':
      return `Turn started · ${projectLabel}`;
    default:
      return `Claude · ${eventType} · ${projectLabel}`;
  }
}

function hintFor(eventType: string, sessionName: string | undefined): string | undefined {
  if (eventType !== 'stop' && eventType !== 'notification' && eventType !== 'subagent-stop') {
    return undefined;
  }
  if (sessionName) {
    return `Reply to this message, or send "@${sessionName} <message>", to target this session.`;
  }
  return 'Reply to this message to route your response to this session.';
}
