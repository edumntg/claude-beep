import { describe, it, expect } from 'vitest';
import { formatDuration } from '../src/commands/status.js';

describe('formatDuration', () => {
  it('formats seconds only', () => {
    expect(formatDuration(5000)).toBe('5s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(125_000)).toBe('2m 5s');
  });

  it('formats hours, minutes, seconds', () => {
    expect(formatDuration(3_725_000)).toBe('1h 2m 5s');
  });
});
