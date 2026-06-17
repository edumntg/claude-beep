import { describe, it, expect } from 'vitest';
import { parseMention } from '../src/inbound-router.js';

describe('parseMention', () => {
  it('extracts a leading @name and the rest as text', () => {
    expect(parseMention('@api do bla bla')).toEqual({ name: 'api', text: 'do bla bla' });
  });

  it('allows hyphens, underscores, digits in the name', () => {
    expect(parseMention('@feat-42_b start')).toEqual({ name: 'feat-42_b', text: 'start' });
  });

  it('strips leading whitespace before the @', () => {
    expect(parseMention('  @ui  resume now')).toEqual({ name: 'ui', text: 'resume now' });
  });

  it('returns the original text when there is no @ prefix', () => {
    expect(parseMention('hello there')).toEqual({ text: 'hello there' });
  });

  it('returns the original text when @ is in the middle', () => {
    expect(parseMention('reach out to @support')).toEqual({ text: 'reach out to @support' });
  });

  it('treats "@name" with no body as a mention with empty text', () => {
    expect(parseMention('@api')).toEqual({ name: 'api', text: '' });
  });

  it('rejects names that start with a hyphen', () => {
    expect(parseMention('@-bad do x')).toEqual({ text: '@-bad do x' });
  });

  it('rejects names longer than 32 chars', () => {
    const tooLong = 'a'.repeat(33);
    expect(parseMention(`@${tooLong} hi`)).toEqual({ text: `@${tooLong} hi` });
  });
});
