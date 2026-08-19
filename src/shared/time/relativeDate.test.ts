import { describe, expect, it } from 'vitest';
import { parseRelativeDate } from './relativeDate';

describe('parseRelativeDate', () => {
  const referenceDate = new Date('2026-08-19T12:00:00.000Z');

  it('parses English relative dates', () => {
    const result = parseRelativeDate('2 hours ago', referenceDate, 'en');
    expect(result.warning).toBeNull();
    expect(result.publishedAt).not.toBeNull();
  });

  it('parses French relative dates', () => {
    const result = parseRelativeDate('il y a 3 heures', referenceDate, 'fr');
    expect(result.warning).toBeNull();
    expect(result.publishedAt).not.toBeNull();
  });

  it('returns unparsed warning for unknown formats', () => {
    const result = parseRelativeDate('some time later', referenceDate, 'en');
    expect(result.publishedAt).toBeNull();
    expect(result.warning).toBe('UNPARSED_DATE');
  });

  it('parses compact Comet timestamps', () => {
    const result = parseRelativeDate('23h', referenceDate, 'en');

    expect(result).toEqual({
      publishedAt: '2026-08-18T13:00:00.000Z',
      warning: null,
    });
  });

  it('parses singular Comet relative dates', () => {
    const result = parseRelativeDate('a day ago', referenceDate, 'en');

    expect(result).toEqual({
      publishedAt: '2026-08-18T12:00:00.000Z',
      warning: null,
    });
  });

  it('parses compact weeks and minutes', () => {
    expect(parseRelativeDate('1w', referenceDate, 'en')).toEqual({
      publishedAt: '2026-08-12T12:00:00.000Z',
      warning: null,
    });
    expect(parseRelativeDate('26m', referenceDate, 'en')).toEqual({
      publishedAt: '2026-08-19T11:34:00.000Z',
      warning: null,
    });
  });

  it('parses article and about forms', () => {
    expect(parseRelativeDate('about an hour ago', referenceDate, 'en')).toEqual({
      publishedAt: '2026-08-19T11:00:00.000Z',
      warning: null,
    });
    expect(parseRelativeDate('a few seconds ago', referenceDate, 'en')).toEqual({
      publishedAt: '2026-08-19T11:59:30.000Z',
      warning: null,
    });
  });

  it('parses compact days and weeks in long form', () => {
    expect(parseRelativeDate('1d', referenceDate, 'en')).toEqual({
      publishedAt: '2026-08-18T12:00:00.000Z',
      warning: null,
    });
    expect(parseRelativeDate('2 weeks ago', referenceDate, 'en')).toEqual({
      publishedAt: '2026-08-05T12:00:00.000Z',
      warning: null,
    });
  });

  it('parses French compact and article forms', () => {
    expect(parseRelativeDate('2 sem', referenceDate, 'fr')).toEqual({
      publishedAt: '2026-08-05T12:00:00.000Z',
      warning: null,
    });
    expect(parseRelativeDate('il y a environ une heure', referenceDate, 'fr')).toEqual({
      publishedAt: '2026-08-19T11:00:00.000Z',
      warning: null,
    });
    expect(parseRelativeDate('26 min', referenceDate, 'fr')).toEqual({
      publishedAt: '2026-08-19T11:34:00.000Z',
      warning: null,
    });
  });

  it('rejects bare numeric strings that would parse as historical years', () => {
    const result = parseRelativeDate('47', referenceDate, 'en');
    expect(result.publishedAt).toBeNull();
    expect(result.warning).toBe('UNPARSED_DATE');
  });
});
