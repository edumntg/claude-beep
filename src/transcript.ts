import fs from 'node:fs';

type Entry = Record<string, unknown>;

function extractAssistantText(entry: Entry): string | null {
  if (!entry || typeof entry !== 'object') return null;

  const role = (entry.role ?? (entry as { type?: string }).type) as string | undefined;
  if (role !== 'assistant') return null;

  const message = (entry as { message?: { content?: unknown } }).message;
  const content =
    (entry as { content?: unknown }).content ?? (message ? message.content : undefined);

  if (typeof content === 'string') return content.trim() || null;

  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is { type?: string; text?: string } => typeof part === 'object' && part !== null)
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text as string)
      .join('\n')
      .trim();
    return text || null;
  }

  return null;
}

export async function lastAssistantText(transcriptPath: string | undefined): Promise<string | null> {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  const content = await fs.promises.readFile(transcriptPath, 'utf8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]) as Entry;
      const text = extractAssistantText(obj);
      if (text) return text;
    } catch {
      // skip unparseable lines
    }
  }
  return null;
}
