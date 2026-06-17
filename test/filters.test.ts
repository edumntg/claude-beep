import { describe, it, expect } from 'vitest';
import { shouldNotify, isInQuietHours } from '../src/filters.js';

const baseFilters = {
  min_turn_seconds: 0,
  notify_on_error: true,
  quiet_hours: [] as string[],
  notify_event_types: ['stop', 'notification', 'subagent-stop'] as Array<
    'stop' | 'notification' | 'subagent-stop'
  >,
};

describe('shouldNotify', () => {
  it('allows by default', () => {
    expect(shouldNotify(baseFilters, { event_type: 'stop' })).toEqual({ allow: true });
  });

  it('drops events not in notify_event_types', () => {
    const defaults = {
      ...baseFilters,
      notify_event_types: ['stop', 'subagent-stop'] as Array<
        'stop' | 'notification' | 'subagent-stop'
      >,
    };
    expect(shouldNotify(defaults, { event_type: 'notification' })).toMatchObject({ allow: false });
    expect(shouldNotify(defaults, { event_type: 'subagent-stop' })).toEqual({ allow: true });
    expect(shouldNotify(defaults, { event_type: 'stop' })).toEqual({ allow: true });
  });

  it('lets all three through when notify_event_types includes them all', () => {
    expect(shouldNotify(baseFilters, { event_type: 'notification' })).toEqual({ allow: true });
    expect(shouldNotify(baseFilters, { event_type: 'subagent-stop' })).toEqual({ allow: true });
  });

  it('drops short turns when min_turn_seconds is set', () => {
    const result = shouldNotify(
      { ...baseFilters, min_turn_seconds: 30 },
      { event_type: 'stop', duration_seconds: 5 },
    );
    expect(result.allow).toBe(false);
    expect(result.reason).toMatch(/min_turn_seconds/);
  });

  it('allows long turns when min_turn_seconds is set', () => {
    const result = shouldNotify(
      { ...baseFilters, min_turn_seconds: 30 },
      { event_type: 'stop', duration_seconds: 45 },
    );
    expect(result.allow).toBe(true);
  });

  it('does not apply min_turn_seconds to non-stop events', () => {
    const result = shouldNotify(
      { ...baseFilters, min_turn_seconds: 30 },
      { event_type: 'notification', duration_seconds: 1 },
    );
    expect(result.allow).toBe(true);
  });

  it('bypasses filters for errors when notify_on_error is true', () => {
    const result = shouldNotify(
      { ...baseFilters, min_turn_seconds: 30, quiet_hours: ['00:00', '23:59'] },
      { event_type: 'stop', duration_seconds: 1, is_error: true, now: new Date(2026, 0, 1, 3, 0) },
    );
    expect(result.allow).toBe(true);
  });
});

describe('isInQuietHours', () => {
  it('detects an interval not wrapping midnight', () => {
    expect(isInQuietHours(new Date(2026, 0, 1, 14, 0), '13:00', '15:00')).toBe(true);
    expect(isInQuietHours(new Date(2026, 0, 1, 12, 59), '13:00', '15:00')).toBe(false);
    expect(isInQuietHours(new Date(2026, 0, 1, 15, 0), '13:00', '15:00')).toBe(false);
  });

  it('detects an interval wrapping midnight', () => {
    expect(isInQuietHours(new Date(2026, 0, 1, 23, 30), '23:00', '07:00')).toBe(true);
    expect(isInQuietHours(new Date(2026, 0, 1, 3, 0), '23:00', '07:00')).toBe(true);
    expect(isInQuietHours(new Date(2026, 0, 1, 7, 0), '23:00', '07:00')).toBe(false);
    expect(isInQuietHours(new Date(2026, 0, 1, 10, 0), '23:00', '07:00')).toBe(false);
  });
});
