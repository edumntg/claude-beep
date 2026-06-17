import type { PastebinProvider } from './types.js';
import { DpasteProvider } from './dpaste.js';
import { GistProvider } from './gist.js';
import type { Config } from '../config/loader.js';
import { appendDaemonLog } from '../logger.js';

export function buildPastebin(config: Config): PastebinProvider | undefined {
  if (!config.pastebin.enabled) return undefined;

  if (config.pastebin.provider === 'dpaste') {
    return new DpasteProvider({
      expiry_days: config.pastebin.dpaste.expiry_days,
      syntax: config.pastebin.dpaste.syntax,
    });
  }

  if (config.pastebin.provider === 'gist') {
    const token = process.env[config.pastebin.gist.token_env];
    if (!token) {
      appendDaemonLog(
        `pastebin (gist) disabled: env var ${config.pastebin.gist.token_env} not set`,
      );
      return undefined;
    }
    return new GistProvider({ token, public: config.pastebin.gist.public });
  }

  return undefined;
}

export type { PastebinProvider } from './types.js';
