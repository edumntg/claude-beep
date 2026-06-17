const starts = new Map<string, number>();
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function recordStart(sessionId: string, ts: number = Date.now()): void {
  evictStale();
  starts.set(sessionId, ts);
}

export function consumeDuration(sessionId: string, now: number = Date.now()): number | undefined {
  const start = starts.get(sessionId);
  if (start === undefined) return undefined;
  starts.delete(sessionId);
  return (now - start) / 1000;
}

export function size(): number {
  return starts.size;
}

export function reset(): void {
  starts.clear();
}

function evictStale(now: number = Date.now()): void {
  for (const [id, ts] of starts.entries()) {
    if (now - ts > MAX_AGE_MS) starts.delete(id);
  }
}
