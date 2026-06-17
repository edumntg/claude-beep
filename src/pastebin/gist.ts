import type { PastebinProvider, PasteOptions } from './types.js';

export interface GistOptions {
  token: string;
  public: boolean;
}

interface GistResponse {
  html_url?: string;
  message?: string;
}

export class GistProvider implements PastebinProvider {
  readonly name = 'gist' as const;
  constructor(private readonly options: GistOptions) {
    if (!options.token) throw new Error('GistProvider: token is empty');
  }

  async upload(text: string, opts: PasteOptions = {}): Promise<string> {
    const description = (opts.title ?? 'Claude Code session').slice(0, 250);
    const safeTitle = description.replace(/[^\w.\- ]+/g, '_').slice(0, 50) || 'session';
    const ext = opts.language === 'markdown' ? 'md' : opts.language ?? 'md';
    const filename = `${safeTitle}.${ext}`;

    const res = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'claude-beep',
      },
      body: JSON.stringify({
        description,
        public: this.options.public,
        files: { [filename]: { content: text } },
      }),
    });

    const json = (await res.json().catch(() => ({}))) as GistResponse;
    if (!res.ok || !json.html_url) {
      throw new Error(`gist upload failed: ${res.status} ${json.message ?? 'no html_url'}`);
    }
    return json.html_url;
  }
}
