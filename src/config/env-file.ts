import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

export const ENV_FILE = path.join(ROOT, 'env');

export function readEnvFile(file: string = ENV_FILE): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[trimmed.slice(0, eq).trim()] = value;
  }
  return out;
}

export function upsertEnvVar(key: string, value: string, file: string = ENV_FILE): void {
  const existing = readEnvFile(file);
  existing[key] = value;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const body = Object.entries(existing)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  fs.writeFileSync(file, body + '\n', { mode: 0o600 });
}

export function loadIntoProcessEnv(file: string = ENV_FILE): number {
  const vars = readEnvFile(file);
  let loaded = 0;
  for (const [k, v] of Object.entries(vars)) {
    if (process.env[k] === undefined || process.env[k] === '') {
      process.env[k] = v;
      loaded += 1;
    }
  }
  return loaded;
}
