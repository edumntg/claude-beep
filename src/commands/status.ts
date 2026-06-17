import net from 'node:net';
import fs from 'node:fs';
import { SOCKET_PATH } from '../config/paths.js';
import type { StatusResponse } from '../ipc/protocol.js';

export async function statusCommand(): Promise<void> {
  if (!fs.existsSync(SOCKET_PATH)) {
    console.error('daemon not running');
    process.exit(1);
  }
  const response = await query();
  if (!response) {
    console.error('daemon not responding (socket exists but no reply)');
    process.exit(1);
  }
  printStatus(response);
}

async function query(): Promise<StatusResponse | null> {
  return new Promise((resolve) => {
    const sock = net.createConnection(SOCKET_PATH);
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(null);
    }, 2000);
    let buf = '';
    sock.on('connect', () => {
      sock.write(JSON.stringify({ type: 'query' }) + '\n');
    });
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf('\n');
      if (idx >= 0) {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(buf.slice(0, idx)) as StatusResponse);
        } catch {
          resolve(null);
        }
        sock.destroy();
      }
    });
    sock.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

function printStatus(s: StatusResponse): void {
  const uptime = formatDuration(s.uptime_ms);
  console.log(`claude-beep daemon: running`);
  console.log(`  pid:        ${s.pid}`);
  console.log(`  uptime:     ${uptime}`);
  console.log(`  started:    ${new Date(s.started_at).toISOString()}`);
  console.log(`  outbound:   ${s.outbound.join(', ') || '(none)'}`);
  console.log(`  inbound:    ${s.inbound.join(', ') || '(none)'}`);
  console.log(`  events seen: ${s.events_seen}`);
  if (s.last_event_at) {
    const ago = Math.round((Date.now() - s.last_event_at) / 1000);
    console.log(`  last event:  ${ago}s ago`);
  }
  console.log(`  sessions (${s.sessions.length}):`);
  if (s.sessions.length === 0) {
    console.log(`    (none — start one with: claude-beep run -- claude)`);
  } else {
    for (const sess of s.sessions) {
      const name = sess.name ? `  name=${sess.name}` : '';
      console.log(`    ${sess.session_id}${name}  pid=${sess.pid}  cwd=${sess.cwd}`);
    }
  }
}

export function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
