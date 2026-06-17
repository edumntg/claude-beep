export interface PasteOptions {
  title?: string;
  language?: string;
}

export interface PastebinProvider {
  readonly name: 'dpaste' | 'gist';
  upload(text: string, opts?: PasteOptions): Promise<string>;
}
