import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { anchorMessageTimestamp } from './anchorMessageTimestamp';
import { buildDateAnchorIndex, parseDateSeparator } from './parseDateSeparator';
import { findMessageElements } from './parseMessage';

// A Friday, so a weekday separator resolves backwards rather than wrapping.
const REFERENCE_DATE = new Date(2026, 7, 28, 23, 30);

const fixturesDirectory = join(import.meta.dirname, '__fixtures__');

function loadThread(name: string): ParentNode {
  document.body.innerHTML = readFileSync(join(fixturesDirectory, name), 'utf8');
  const log = document.body.querySelector('div[role="log"]');
  if (log === null) {
    throw new Error(`Thread fixture "${name}" has no message log`);
  }

  return log;
}

describe('parseDateSeparator', () => {
  it('reads the abbreviated absolute form the separators actually use', () => {
    const anchor = parseDateSeparator('15 Jul 2026, 17:38', REFERENCE_DATE);

    expect(anchor).toEqual({ year: 2026, month: 6, day: 15, namesADay: true });
  });

  it('reads an abbreviated weekday as the most recent one already past', () => {
    const anchor = parseDateSeparator('Tue 20:06', REFERENCE_DATE);

    expect(anchor).toEqual({ year: 2026, month: 7, day: 25, namesADay: true });
  });

  it('reads the full weekday name as well as the abbreviation', () => {
    expect(parseDateSeparator('Tuesday 20:06', REFERENCE_DATE)).toEqual(
      parseDateSeparator('Tue 20:06', REFERENCE_DATE),
    );
  });

  // A separator showing only a clock time names no day, so it must not be
  // allowed to date anything.
  it('reports a clock-only separator as naming no day', () => {
    const anchor = parseDateSeparator('19:39', REFERENCE_DATE);

    expect(anchor?.namesADay).toBe(false);
  });

  it('refuses text that is not a separator', () => {
    expect(parseDateSeparator('You created this group', REFERENCE_DATE)).toBeNull();
    expect(parseDateSeparator(null, REFERENCE_DATE)).toBeNull();
  });
});

describe('buildDateAnchorIndex', () => {
  it('anchors the messages that follow a dated separator', () => {
    const log = loadThread('thread-absolute-dates.html');
    const anchors = buildDateAnchorIndex(log, REFERENCE_DATE);
    const messages = findMessageElements(log);

    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(anchors.get(message)).toEqual({
        year: 2026,
        month: 6,
        day: 15,
        namesADay: true,
      });
    }
  });

  it('anchors nothing in a thread whose separators are clock times only', () => {
    const log = loadThread('thread-same-day.html');

    expect(buildDateAnchorIndex(log, REFERENCE_DATE).size).toBe(0);
  });
});

describe('anchorMessageTimestamp', () => {
  // The failure this exists to fix: a clock-only label read on its own lands on
  // the day of the capture, however far back the thread has been scrolled.
  it('moves a clock-only message onto the day its separator names', () => {
    const anchored = anchorMessageTimestamp('17:38', {
      year: 2019,
      month: 2,
      day: 4,
      namesADay: true,
    });

    expect(anchored?.sentAt).toBe(new Date(2019, 2, 4, 17, 38).toISOString());
    expect(anchored?.inferred).toBe(false);
  });

  it('moves a weekday message onto the day its separator names', () => {
    const anchored = anchorMessageTimestamp('Tuesday 14:51', {
      year: 2019,
      month: 2,
      day: 4,
      namesADay: true,
    });

    expect(anchored?.sentAt).toBe(new Date(2019, 2, 4, 14, 51).toISOString());
  });

  it('declines to anchor when the separator names no day', () => {
    expect(
      anchorMessageTimestamp('17:38', {
        year: 2026,
        month: 7,
        day: 28,
        namesADay: false,
      }),
    ).toBeNull();
  });

  // A message whose own label is already absolute needs no help, and must not be
  // moved onto the separator's day.
  it('declines to anchor a label that already carries its own date', () => {
    expect(
      anchorMessageTimestamp('15 July 2026, 17:38', {
        year: 2019,
        month: 2,
        day: 4,
        namesADay: true,
      }),
    ).toBeNull();
  });

  it('declines to anchor when there is no separator', () => {
    expect(anchorMessageTimestamp('17:38', null)).toBeNull();
  });
});
