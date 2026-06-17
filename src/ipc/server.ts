import net from 'node:net';
import fs from 'node:fs';
import { SOCKET_PATH } from '../config/paths.js';
import { ensureRoot, cleanupStaleSocket } from './socket.js';
import type { NormalizedEvent } from '../events/schema.js';
import type { StatusResponse } from './protocol.js';

export interface SessionHandle {
  session_id: string;
  pid: number;
  cwd: string;
  name?: string;
  inject(text: string): void;
  close(): void;
}

export interface ServerHandlers {
  onEvent: (event: NormalizedEvent) => void | Promise<void>;
  onSessionStart?: (handle: SessionHandle) => void;
  onSessionEnd?: (session_id: string) => void;
  onQuery?: () => StatusResponse;
}

export function startIpcServer(handlers: ServerHandlers): net.Server {
  ensureRoot();
  cleanupStaleSocket();

  const server = net.createServer((conn) => {
    let buf = '';
    let boundSessionId: string | undefined;

    const write = (msg: unknown) => {
      try {
        conn.write(JSON.stringify(msg) + '\n');
      } catch {
        /* ignore */
      }
    };

    const handleLine = (line: string) => {
      let msg: { type?: string } & Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }

      if (!msg.type && typeof msg === 'object' && 'event_type' in msg) {
        Promise.resolve(handlers.onEvent(msg as unknown as NormalizedEvent)).catch(() => {});
        return;
      }

      if (msg.type === 'event') {
        const event = (msg as { payload?: NormalizedEvent }).payload;
        if (event) Promise.resolve(handlers.onEvent(event)).catch(() => {});
        return;
      }

      if (msg.type === 'query') {
        if (handlers.onQuery) {
          const status = handlers.onQuery();
          write(status);
        }
        try {
          conn.end();
        } catch {
          /* ignore */
        }
        return;
      }

      if (msg.type === 'register') {
        const sessionId = String(msg.session_id ?? '');
        if (!sessionId) return;
        boundSessionId = sessionId;
        const rawName = msg.name === undefined ? undefined : String(msg.name);
        const handle: SessionHandle = {
          session_id: sessionId,
          pid: Number(msg.pid ?? 0),
          cwd: String(msg.cwd ?? ''),
          name: rawName,
          inject(text: string) {
            write({ type: 'inject', text });
          },
          close() {
            try {
              conn.end();
            } catch {
              /* ignore */
            }
          },
        };
        handlers.onSessionStart?.(handle);
        return;
      }

      if (msg.type === 'unregister') {
        const sessionId = String(msg.session_id ?? boundSessionId ?? '');
        if (sessionId) handlers.onSessionEnd?.(sessionId);
        boundSessionId = undefined;
        try {
          conn.end();
        } catch {
          /* ignore */
        }
        return;
      }
    };

    conn.on('data', (chunk) => {
      buf += chunk.toString();
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) handleLine(line);
      }
    });

    conn.on('close', () => {
      if (boundSessionId) {
        handlers.onSessionEnd?.(boundSessionId);
        boundSessionId = undefined;
      }
    });

    conn.on('error', () => {
      /* ignore */
    });
  });

  server.listen(SOCKET_PATH, () => {
    fs.chmodSync(SOCKET_PATH, 0o600);
  });

  return server;
}
