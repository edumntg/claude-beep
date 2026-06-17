import path from 'node:path';
import os from 'node:os';
import { formatDuration } from './commands/status.js';
import type { ChatMessage } from './transports/types.js';
import type { SessionHandle } from './ipc/server.js';

export interface ParsedBotCommand {
  name: 'sessions' | 'status' | 'help';
  args: string;
}

const COMMAND_PATTERN = /^\/(sessions|status|help|sess|s|ls|info)(?:\s+([\s\S]*))?$/i;

const ALIASES: Record<string, ParsedBotCommand['name']> = {
  sessions: 'sessions',
  sess: 'sessions',
  ls: 'sessions',
  s: 'status',
  status: 'status',
  info: 'status',
  help: 'help',
};

export function parseBotCommand(text: string): ParsedBotCommand | undefined {
  const m = text.trim().match(COMMAND_PATTERN);
  if (!m) return undefined;
  const verb = m[1].toLowerCase();
  const name = ALIASES[verb];
  if (!name) return undefined;
  return { name, args: (m[2] ?? '').trim() };
}

export interface DaemonState {
  pid: number;
  startedAt: number;
  outbound: string[];
  inbound: string[];
  eventsSeen: number;
  lastEventAt?: number;
}

export function buildSessionsReply(sessions: SessionHandle[]): ChatMessage {
  if (sessions.length === 0) {
    return {
      title: 'No active sessions',
      emoji: '📋',
      fields: [],
      excerpt:
        'Start one with: claude-beep run --name <name> -- claude\n\n' +
        'Without a name, the session label is auto-generated from the directory + a short ID.',
    };
  }
  const lines = sessions.map((s) => {
    const label = s.name ? `@${s.name}` : s.session_id.slice(0, 8);
    return `${label}  ·  ${prettyCwd(s.cwd)}  ·  pid ${s.pid}`;
  });
  const plural = sessions.length === 1 ? '' : 's';
  return {
    title: `${sessions.length} active session${plural}`,
    emoji: '📋',
    fields: [],
    excerpt: lines.join('\n'),
    hint: 'Send "@<name> <message>" to target a specific session.',
  };
}

export function buildStatusReply(state: DaemonState, sessionCount: number): ChatMessage {
  const uptime = formatDuration(Date.now() - state.startedAt);
  const fields = [
    { icon: '🆔', label: 'PID', value: String(state.pid) },
    { icon: '⏱', label: 'Uptime', value: uptime },
    { icon: '📤', label: 'Outbound', value: state.outbound.join(', ') || '(none)' },
    { icon: '📥', label: 'Inbound', value: state.inbound.join(', ') || '(none)' },
    { icon: '🧵', label: 'Sessions', value: String(sessionCount) },
    { icon: '📊', label: 'Events seen', value: String(state.eventsSeen) },
  ];
  return {
    title: 'Daemon status',
    emoji: '🟢',
    fields,
  };
}

export function buildHelpReply(): ChatMessage {
  return {
    title: 'claude-beep commands',
    emoji: '🤖',
    fields: [],
    excerpt:
      'Bot commands (send in chat):\n' +
      '  /sessions  — list active Claude sessions\n' +
      '  /status    — daemon health\n' +
      '  /help      — this message\n\n' +
      'Reply patterns:\n' +
      '  @<name> <text>       — target a named session\n' +
      '  Reply to a notification — target that session\n' +
      '  Plain text           — target the most-recent session',
  };
}

function prettyCwd(cwd: string): string {
  const home = os.homedir();
  if (cwd === home) return '~';
  if (cwd.startsWith(home + path.sep)) return '~' + cwd.slice(home.length);
  return cwd;
}
