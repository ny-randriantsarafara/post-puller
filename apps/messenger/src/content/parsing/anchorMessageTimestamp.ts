import { MESSAGE_TIMESTAMP_PATTERNS } from './selectors';
import type { DateAnchor } from './parseDateSeparator';

export type AnchoredTimestamp = {
  sentAt: string | null;
  // False once a real day has been supplied by a separator, since the instant no
  // longer depends on the day the capture happened to run.
  inferred: boolean;
};

// A message's own label carries a clock time and, in older parts of a thread,
// nothing else. Read alone it resolves to the day of the capture, which is wrong
// by however far back the thread has been scrolled. The separator above it names
// the real day, and combining the two is what makes a multi-year thread come out
// with correct dates.
export function anchorMessageTimestamp(
  displayedAt: string | null,
  anchor: DateAnchor | null,
): AnchoredTimestamp | null {
  if (displayedAt === null || anchor === null || !anchor.namesADay) {
    return null;
  }

  const clockTime = MESSAGE_TIMESTAMP_PATTERNS.clockTime.exec(displayedAt.trim());
  const weekday = MESSAGE_TIMESTAMP_PATTERNS.weekdayAndClockTime.exec(
    displayedAt.trim(),
  );

  const hour = clockTime?.[1] ?? weekday?.[2];
  const minute = clockTime?.[2] ?? weekday?.[3];
  if (hour === undefined || minute === undefined) {
    return null;
  }

  const anchored = new Date(
    anchor.year,
    anchor.month,
    anchor.day,
    Number(hour),
    Number(minute),
  );

  return { sentAt: anchored.toISOString(), inferred: false };
}
