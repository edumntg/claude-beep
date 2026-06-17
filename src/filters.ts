import type { Filters } from './config/loader.js';

export interface FilterContext {
  event_type: string;
  duration_seconds?: number;
  is_error?: boolean;
  now?: Date;
}

export interface FilterResult {
  allow: boolean;
  reason?: string;
}

export function shouldNotify(filters: Filters, ctx: FilterContext): FilterResult {
  if (ctx.is_error && filters.notify_on_error) return { allow: true };

  // Event-type allowlist. Defaults to ['stop'] so we suppress Notification and
  // SubagentStop noise. Users can re-enable by editing notify_event_types.
  if (
    ctx.event_type === 'stop' ||
    ctx.event_type === 'notification' ||
    ctx.event_type === 'subagent-stop'
  ) {
    if (!filters.notify_event_types.includes(ctx.event_type)) {
      return {
        allow: false,
        reason: `event type "${ctx.event_type}" not in notify_event_types`,
      };
    }
  }

  if (
    filters.min_turn_seconds > 0 &&
    ctx.event_type === 'stop' &&
    (ctx.duration_seconds ?? 0) < filters.min_turn_seconds
  ) {
    return {
      allow: false,
      reason: `turn ${(ctx.duration_seconds ?? 0).toFixed(1)}s < min_turn_seconds (${filters.min_turn_seconds}s)`,
    };
  }

  if (filters.quiet_hours.length === 2) {
    const now = ctx.now ?? new Date();
    if (isInQuietHours(now, filters.quiet_hours[0], filters.quiet_hours[1])) {
      return { allow: false, reason: 'quiet hours' };
    }
  }

  return { allow: true };
}

export function isInQuietHours(now: Date, startHHmm: string, endHHmm: string): boolean {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = parseHHmm(startHHmm);
  const endMin = parseHHmm(endHHmm);
  if (startMin === endMin) return false;
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;
}

function parseHHmm(s: string): number {
  const [h, m] = s.split(':').map((n) => Number.parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}
