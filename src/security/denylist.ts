import { globMatch } from '../routing.js';

export const DEFAULT_SENSITIVE_PATHS = [
  '**/.env',
  '**/.env.*',
  '**/credentials/**',
  '**/secrets/**',
  '**/*.pem',
  '**/*.key',
];

export function isSensitivePath(cwd: string | undefined, denylist: string[]): boolean {
  if (!cwd) return false;
  for (const pattern of denylist) {
    if (globMatch(pattern, cwd)) return true;
  }
  return false;
}
