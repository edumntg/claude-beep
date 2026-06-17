export interface MentionParseResult {
  name?: string;
  text: string;
}

// First char must be alphanumeric; same shape as SESSION_NAME_PATTERN.
const MENTION_PATTERN = /^@([A-Za-z0-9][A-Za-z0-9_-]{0,31})(?:\s+([\s\S]+))?$/;

export function parseMention(raw: string): MentionParseResult {
  const trimmed = raw.trimStart();
  const match = trimmed.match(MENTION_PATTERN);
  if (!match) return { text: raw };
  const [, name, rest] = match;
  return { name, text: (rest ?? '').trim() };
}
