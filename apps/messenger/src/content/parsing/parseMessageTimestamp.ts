import {
  MESSAGE_TIMESTAMP_PATTERNS,
  MONTH_NAMES,
  WEEKDAY_NAMES,
} from './selectors';

export type MessageTimestampResult = {
  sentAt: string | null;
  // Set when the displayed value carried no date of its own and the instant was
  // reconstructed from the day of the capture.
  inferred: boolean;
  parsed: boolean;
};

const DAYS_IN_WEEK = 7;

function atClockTime(referenceDate: Date, hour: number, minute: number): Date {
  return new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    hour,
    minute,
    0,
    0,
  );
}

function shiftDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    0,
    0,
  );
}

function indexOfName(names: readonly string[], value: string): number {
  return names.findIndex((name) => name.toLowerCase() === value.toLowerCase());
}

// A bare clock time means today, unless today has not reached it yet - which
// happens when a capture runs either side of midnight.
function resolveClockTime(referenceDate: Date, hour: number, minute: number): Date {
  const sameDay = atClockTime(referenceDate, hour, minute);
  if (sameDay.getTime() <= referenceDate.getTime()) {
    return sameDay;
  }

  return shiftDays(sameDay, -1);
}

// A weekday name means the most recent one that has already passed. Messenger
// switches to a bare clock time for today, so the name of today's weekday
// refers to a week ago rather than to this morning.
function resolveWeekday(
  referenceDate: Date,
  weekdayIndex: number,
  hour: number,
  minute: number,
): Date {
  const sameDay = atClockTime(referenceDate, hour, minute);
  const daysSince = (sameDay.getDay() - weekdayIndex + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  if (daysSince === 0) {
    return shiftDays(sameDay, -DAYS_IN_WEEK);
  }

  return shiftDays(sameDay, -daysSince);
}

export function parseMessageTimestamp(
  displayedAt: string | null,
  referenceDate: Date,
): MessageTimestampResult {
  if (displayedAt === null || displayedAt.trim().length === 0) {
    return { sentAt: null, inferred: false, parsed: false };
  }

  const normalized = displayedAt.trim();

  const absolute = MESSAGE_TIMESTAMP_PATTERNS.absolute.exec(normalized);
  if (absolute !== null) {
    const monthIndex = indexOfName(MONTH_NAMES, absolute[2] ?? '');
    if (monthIndex !== -1) {
      const resolved = new Date(
        Number(absolute[3]),
        monthIndex,
        Number(absolute[1]),
        Number(absolute[4]),
        Number(absolute[5]),
        0,
        0,
      );
      return { sentAt: resolved.toISOString(), inferred: false, parsed: true };
    }
  }

  const weekday = MESSAGE_TIMESTAMP_PATTERNS.weekdayAndClockTime.exec(normalized);
  if (weekday !== null) {
    const weekdayIndex = indexOfName(WEEKDAY_NAMES, weekday[1] ?? '');
    if (weekdayIndex !== -1) {
      const resolved = resolveWeekday(
        referenceDate,
        weekdayIndex,
        Number(weekday[2]),
        Number(weekday[3]),
      );
      return { sentAt: resolved.toISOString(), inferred: true, parsed: true };
    }
  }

  const clockTime = MESSAGE_TIMESTAMP_PATTERNS.clockTime.exec(normalized);
  if (clockTime !== null) {
    const resolved = resolveClockTime(
      referenceDate,
      Number(clockTime[1]),
      Number(clockTime[2]),
    );
    return { sentAt: resolved.toISOString(), inferred: true, parsed: true };
  }

  return { sentAt: null, inferred: false, parsed: false };
}
