import fs from 'node:fs';
import { LOG_DIR, EVENTS_LOG, DAEMON_LOG } from './config/paths.js';

export function ensureLogDir(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export function appendEventLog(line: object): void {
  ensureLogDir();
  fs.appendFileSync(EVENTS_LOG, JSON.stringify(line) + '\n');
}

export function appendDaemonLog(line: string): void {
  ensureLogDir();
  fs.appendFileSync(DAEMON_LOG, `[${new Date().toISOString()}] ${line}\n`);
}
