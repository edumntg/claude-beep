import fs from 'node:fs';
import { SOCKET_PATH, ROOT } from '../config/paths.js';

export function ensureRoot(): void {
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
}

export function cleanupStaleSocket(): void {
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
