import net from 'node:net';
import { SOCKET_PATH } from '../config/paths.js';

export interface SendResult {
  ok: boolean;
  error?: string;
}

const RETRY_ERRORS = ['ENOENT', 'ECONNREFUSED'];
const RETRIES = 3;
const RETRY_DELAY_MS = 50;

export async function sendToDaemon(payload: unknown, timeoutMs = 250): Promise<SendResult> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const result = await tryOnce(payload, timeoutMs);
    if (result.ok) return result;
    if (attempt < RETRIES && shouldRetry(result.error)) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    return result;
  }
  return { ok: false, error: 'exhausted retries' };
}

function shouldRetry(err: string | undefined): boolean {
  if (!err) return false;
  return RETRY_ERRORS.some((code) => err.includes(code));
}

function tryOnce(payload: unknown, timeoutMs: number): Promise<SendResult> {
  return new Promise((resolve) => {
    const sock = net.createConnection(SOCKET_PATH);
    const cleanup = (result: SendResult) => {
      clearTimeout(timer);
      sock.removeAllListeners();
      sock.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => cleanup({ ok: false, error: 'timeout' }), timeoutMs);
    sock.once('connect', () => {
      sock.end(JSON.stringify(payload) + '\n', () => cleanup({ ok: true }));
    });
    sock.once('error', (err) => cleanup({ ok: false, error: err.message }));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
