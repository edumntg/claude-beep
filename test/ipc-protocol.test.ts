import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(os.tmpdir(), `cb-ipc-${process.pid}-${Date.now()}`);
process.env.CLAUDE_BEEP_HOME = ROOT;

const serverMod = await import('../src/ipc/server.js');
const pathsMod = await import('../src/config/paths.js');

describe('IPC protocol', () => {
  let server: net.Server;

  beforeEach(() => {
    fs.mkdirSync(ROOT, { recursive: true });
  });

  afterEach(() => {
    server?.close();
    try {
      fs.rmSync(ROOT, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('dispatches typed event messages', async () => {
    const events: unknown[] = [];
    server = serverMod.startIpcServer({
      onEvent: (e) => {
        events.push(e);
      },
    });
    await sleep(50);
    await sendLines([
      JSON.stringify({
        type: 'event',
        payload: { event_type: 'stop', received_at: 1, raw: {} },
      }),
    ]);
    await sleep(100);
    expect(events).toHaveLength(1);
    expect((events[0] as { event_type: string }).event_type).toBe('stop');
  });

  it('handles register/inject/unregister', async () => {
    let captured: { handle?: import('../src/ipc/server.js').SessionHandle } = {};
    const ended: string[] = [];
    server = serverMod.startIpcServer({
      onEvent: () => {},
      onSessionStart: (h) => {
        captured.handle = h;
      },
      onSessionEnd: (id) => {
        ended.push(id);
      },
    });
    await sleep(50);

    const sock = net.createConnection(pathsMod.SOCKET_PATH);
    await new Promise((r) => sock.once('connect', r));

    const received: string[] = [];
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        received.push(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    });

    sock.write(
      JSON.stringify({ type: 'register', session_id: 'sess-x', pid: 1234, cwd: '/tmp' }) + '\n',
    );
    await sleep(50);
    expect(captured.handle?.session_id).toBe('sess-x');

    captured.handle?.inject('hello there');
    await sleep(50);
    expect(received).toHaveLength(1);
    const parsed = JSON.parse(received[0]);
    expect(parsed).toEqual({ type: 'inject', text: 'hello there' });

    sock.write(JSON.stringify({ type: 'unregister', session_id: 'sess-x' }) + '\n');
    await sleep(50);
    expect(ended).toContain('sess-x');

    sock.destroy();
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendLines(lines: string[]): Promise<void> {
  const sock = net.createConnection(pathsMod.SOCKET_PATH);
  await new Promise((r) => sock.once('connect', r));
  for (const line of lines) sock.write(line + '\n');
  await new Promise((r) => sock.end(r));
}
