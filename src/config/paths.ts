import os from 'node:os';
import path from 'node:path';

export const ROOT = process.env.CLAUDE_BEEP_HOME ?? path.join(os.homedir(), '.claude-beep');
export const CONFIG_FILE = path.join(ROOT, 'config.yaml');
export const SOCKET_PATH = path.join(ROOT, 'sock');
export const LOG_DIR = path.join(ROOT, 'logs');
export const EVENTS_LOG = path.join(LOG_DIR, 'events.jsonl');
export const DAEMON_LOG = path.join(LOG_DIR, 'daemon.log');
export const PID_FILE = path.join(ROOT, 'daemon.pid');
export const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
