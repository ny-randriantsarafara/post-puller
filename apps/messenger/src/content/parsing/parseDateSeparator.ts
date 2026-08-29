import {
  DATE_SEPARATOR_PATTERNS,
  MONTH_NAMES,
  SELECTORS,
  WEEKDAY_NAMES,
} from './selectors';

// The day a group of messages belongs to, taken from the separator above them.
export type DateAnchor = {
  year: number;
  month: number;
  day: number;
  // A separator that shows only a clock time names no day of its own, so it can
  // only mean the day of the capture and tells a message nothing it did not
  // already know. Anchoring is skipped for those rather than pretending.
  namesADay: boolean;
};

const DAYS_IN_WEEK = 7;

function indexOfNameByPrefix(names: readonly string[], value: string): number {
  const normalized = value.toLowerCase();

  return names.findIndex((name) => {
    const candidate = name.toLowerCase();
    return candidate === normalized || candidate.startsWith(normalized);
  });
}

function anchorOf(date: Date, namesADay: boolean): DateAnchor {
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
    namesADay,
  };
}

// A weekday name means the most recent one already past. Messenger shows a bare
// clock time for today, so today's own weekday name refers to a week ago.
function resolveWeekday(referenceDate: Date, weekdayIndex: number): Date {
  const daysSince = (referenceDate.getDay() - weekdayIndex + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  const dayShift = daysSince === 0 ? DAYS_IN_WEEK : daysSince;

  return new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate() - dayShift,
  );
}

export function parseDateSeparator(
  text: string | null,
  referenceDate: Date,
): DateAnchor | null {
  if (text === null) {
    return null;
  }

  const normalized = text.trim();

  const absolute = DATE_SEPARATOR_PATTERNS.absolute.exec(normalized);
  if (absolute !== null) {
    const monthIndex = indexOfNameByPrefix(MONTH_NAMES, absolute[2] ?? '');
    if (monthIndex !== -1) {
      return anchorOf(
        new Date(Number(absolute[3]), monthIndex, Number(absolute[1])),
        true,
      );
    }
  }

  const weekday = DATE_SEPARATOR_PATTERNS.weekdayAndClockTime.exec(normalized);
  if (weekday !== null) {
    const weekdayIndex = indexOfNameByPrefix(WEEKDAY_NAMES, weekday[1] ?? '');
    if (weekdayIndex !== -1) {
      return anchorOf(resolveWeekday(referenceDate, weekdayIndex), true);
    }
  }

  if (DATE_SEPARATOR_PATTERNS.clockTime.test(normalized)) {
    return anchorOf(referenceDate, false);
  }

  return null;
}

// Maps each rendered message to the day named by the nearest separator above it.
//
// Scrolling upward means a day's messages are parsed before the separator that
// dates them comes into view, so this index is rebuilt on every batch: once the
// separator is rendered, the messages under it are still in the window, are
// re-parsed with the anchor, and are re-emitted as a strictly better version of
// the same message.
export function buildDateAnchorIndex(
  root: ParentNode,
  referenceDate: Date,
): Map<Element, DateAnchor> {
  const anchorsByMessage = new Map<Element, DateAnchor>();
  const markers = root.querySelectorAll(
    `${SELECTORS.dateBreak}, ${SELECTORS.messageRow}`,
  );

  let currentAnchor: DateAnchor | null = null;

  for (const marker of markers) {
    if (marker.matches(SELECTORS.dateBreak)) {
      const anchor = parseDateSeparator(marker.textContent, referenceDate);
      if (anchor !== null && anchor.namesADay) {
        currentAnchor = anchor;
      }
      continue;
    }

    if (currentAnchor !== null) {
      anchorsByMessage.set(marker, currentAnchor);
    }
  }

  return anchorsByMessage;
}
