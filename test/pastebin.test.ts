import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DpasteProvider } from '../src/pastebin/dpaste.js';
import { GistProvider } from '../src/pastebin/gist.js';

const realFetch = global.fetch;

describe('DpasteProvider', () => {
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('POSTs form-encoded body and returns the URL', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return {
        ok: true,
        text: async () => 'https://dpaste.com/ABC123\n',
      } as Response;
    }) as typeof fetch;

    const dp = new DpasteProvider({ expiry_days: 14, syntax: 'markdown' });
    const url = await dp.upload('hello world', { title: 'test' });

    expect(url).toBe('https://dpaste.com/ABC123');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://dpaste.com/api/v2/');
    expect(calls[0].init.method).toBe('POST');
    expect(String(calls[0].init.body)).toContain('content=hello+world');
    expect(String(calls[0].init.body)).toContain('expiry_days=14');
  });

  it('throws on non-2xx', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'oops',
    } as Response)) as typeof fetch;

    const dp = new DpasteProvider({ expiry_days: 7, syntax: 'text' });
    await expect(dp.upload('x')).rejects.toThrow(/dpaste upload failed: 500/);
  });

  it('throws if response is not a URL', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => 'not a url',
    } as Response)) as typeof fetch;
    const dp = new DpasteProvider({ expiry_days: 7, syntax: 'text' });
    await expect(dp.upload('x')).rejects.toThrow(/unexpected body/);
  });
});

describe('GistProvider', () => {
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('sends a Bearer token and returns html_url', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return {
        ok: true,
        json: async () => ({ html_url: 'https://gist.github.com/u/abc123' }),
      } as Response;
    }) as typeof fetch;

    const gist = new GistProvider({ token: 'ghp_TESTTOKEN', public: false });
    const url = await gist.upload('# heading\n\nbody', { title: 'Claude finished', language: 'md' });

    expect(url).toBe('https://gist.github.com/u/abc123');
    expect(calls).toHaveLength(1);
    const headers = (calls[0].init.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer ghp_TESTTOKEN');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.public).toBe(false);
    expect(body.description).toBe('Claude finished');
    expect(Object.keys(body.files)[0]).toMatch(/\.md$/);
  });

  it('throws when token is empty', () => {
    expect(() => new GistProvider({ token: '', public: false })).toThrow(/token is empty/);
  });

  it('throws when API returns no html_url', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Bad credentials' }),
    } as Response)) as typeof fetch;
    const gist = new GistProvider({ token: 't', public: false });
    await expect(gist.upload('x')).rejects.toThrow(/Bad credentials/);
  });
});
