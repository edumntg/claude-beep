import net from 'node:net';
import crypto from 'node:crypto';
import pty from 'node-pty';
import { SOCKET_PATH } from '../config/paths.js';
import { SESSION_NAME_PATTERN } from '../ipc/protocol.js';

const MAX_RECONNECT_DELAY_MS = 10_000;

export interface RunOptions {
  name?: string;
}

export async function runCommand(rawArgs: string[], opts: RunOptions = {}): Promise<void> {
  if (rawArgs.length === 0) {
    console.error('usage: claude-beep run [--name NAME] -- <command> [args...]');
    process.exit(2);
  }

  const sessionId = crypto.randomUUID();
  const cwd = process.cwd();
  const [bin, ...binArgs] = rawArgs;

  let name = opts.name?.trim() || undefined;
  if (name && !SESSION_NAME_PATTERN.test(name)) {
    console.error(
      `invalid session name "${name}". Use 1-32 chars: letters, digits, _ or -. Must start with a letter or digit.`,
    );
    process.exit(2);
  }

  const childEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    CLAUDE_BEEP_WRAPPER_ID: sessionId,
  };
  if (name) childEnv.CLAUDE_BEEP_SESSION_NAME = name;

  const child = pty.spawn(bin, binArgs, {
    name: process.env.TERM || 'xterm-256color',
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    cwd,
    env: childEnv,
  });

  child.onData((data: string) => {
    process.stdout.write(data);
  });

  const wasRaw = process.stdin.isTTY ? process.stdin.isRaw : false;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (data) => {
    child.write(data.toString());
  });

  process.stdout.on('resize', () => {
    try {
      child.resize(process.stdout.columns || 80, process.stdout.rows || 24);
    } catch {
      /* ignore */
    }
  });

  let exiting = false;
  let activeSock: net.Socket | undefined;
  let reconnectDelay = 500;

  const connect = () => {
    if (exiting) return;
    const sock = net.createConnection(SOCKET_PATH);
    activeSock = sock;
    let buf = '';

    sock.on('connect', () => {
      reconnectDelay = 500;
      const payload: Record<string, unknown> = {
        type: 'register',
        session_id: sessionId,
        pid: child.pid,
        cwd,
      };
      if (name) payload.name = name;
      sock.write(JSON.stringify(payload) + '\n');
    });
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as { type?: string; text?: string };
          if (msg.type === 'inject' && typeof msg.text === 'string') {
            // Two-write inject so Claude's TUI sees the submit as a real
            // keypress rather than a paste (see v0.3.1 fix).
            const body = msg.text.replace(/[\r\n]+$/, '');
            if (body.length > 0) child.write(body);
            setTimeout(() => child.write('\r'), 25);
          }
        } catch {
          /* ignore */
        }
      }
    });
    sock.on('error', () => {
      /* the 'close' handler schedules the reconnect */
    });
    sock.on('close', () => {
      if (activeSock === sock) activeSock = undefined;
      if (exiting) return;
      const delay = reconnectDelay;
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
      setTimeout(connect, delay);
    });
  };

  connect();

  const cleanup = (code: number) => {
    exiting = true;
    if (activeSock) {
      try {
        activeSock.write(JSON.stringify({ type: 'unregister', session_id: sessionId }) + '\n');
        activeSock.end();
      } catch {
        /* ignore */
      }
    }
    if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
    process.exit(code);
  };

  child.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    cleanup(typeof exitCode === 'number' ? exitCode : (signal ?? 1));
  });

  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}
