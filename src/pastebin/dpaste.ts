import type { PastebinProvider, PasteOptions } from './types.js';

export interface DpasteOptions {
  expiry_days: number;
  syntax: string;
}

export class DpasteProvider implements PastebinProvider {
  readonly name = 'dpaste' as const;
  constructor(private readonly options: DpasteOptions) {}

  async upload(text: string, opts: PasteOptions = {}): Promise<string> {
    const params = new URLSearchParams({
      content: text,
      syntax: opts.language ?? this.options.syntax,
      title: (opts.title ?? 'Claude Code session').slice(0, 100),
      expiry_days: String(this.options.expiry_days),
    });
    const res = await fetch('https://dpaste.com/api/v2/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`dpaste upload failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const url = (await res.text()).trim();
    if (!url.startsWith('http')) {
      throw new Error(`dpaste returned unexpected body: ${url.slice(0, 100)}`);
    }
    return url;
  }
}
