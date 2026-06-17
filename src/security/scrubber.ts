const BUILTIN_PATTERNS: Array<[RegExp, string]> = [
  // Authorization headers — keep the header name, redact the value.
  [/(Authorization\s*:\s*)([A-Za-z]+\s+\S+)/gi, '$1[REDACTED]'],
  // Bearer tokens
  [/\bBearer\s+[A-Za-z0-9._\-+/=]{16,}/g, 'Bearer [REDACTED]'],
  // OpenAI-style keys
  [/\bsk-[A-Za-z0-9_-]{20,}/g, '[REDACTED]'],
  // Anthropic-style keys
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/g, '[REDACTED]'],
  // GitHub tokens
  [/\bghp_[A-Za-z0-9]{20,}/g, '[REDACTED]'],
  [/\bgho_[A-Za-z0-9]{20,}/g, '[REDACTED]'],
  [/\bghs_[A-Za-z0-9]{20,}/g, '[REDACTED]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED]'],
  // JWTs
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, '[REDACTED]'],
  // AWS access key IDs
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]'],
  // Slack tokens
  [/\bxox[abprs]-[A-Za-z0-9-]+/g, '[REDACTED]'],
  // Telegram bot tokens — numeric_id:opaque_35chars
  [/\b\d{8,12}:[A-Za-z0-9_-]{35}\b/g, '[REDACTED]'],
  // Discord bot tokens — 3 base64ish segments joined by `.`
  [/\b[MN][A-Za-z0-9]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g, '[REDACTED]'],
  // KEY=VALUE / KEY: VALUE where KEY is *TOKEN|*SECRET|*KEY|*PASSWORD|*PASSPHRASE|*API_KEY
  [
    /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|PASSPHRASE|API_?KEY))\s*[=:]\s*['"]?([^\s'"]{4,})['"]?/gi,
    '$1=[REDACTED]',
  ],
];

export interface ScrubberOptions {
  enabled: boolean;
  extra_patterns: string[];
}

export function scrub(text: string, opts: ScrubberOptions): string {
  if (!opts.enabled) return text;
  let out = text;
  for (const [pattern, replacement] of BUILTIN_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  for (const raw of opts.extra_patterns) {
    try {
      out = out.replace(new RegExp(raw, 'gi'), '[REDACTED]');
    } catch {
      /* skip malformed regex */
    }
  }
  return out;
}
