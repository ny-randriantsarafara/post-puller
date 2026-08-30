// What a scan saw, as opposed to what it stored. An item re-rendered and read a
// second time is counted twice here, so these numbers measure the scan's work
// rather than the records it produced; the records are counted per collection in
// the session's collectionStats.
export type ScanStats = {
  readonly seenItemCount: number;
  // Items the page recycled, detached or made unparseable before the batch that
  // was going to read them got there. Some are read again on a later render, so
  // this is not a count of items lost. It is how hard the scan is racing the
  // page, and it is the number that separates a page holding nothing to capture
  // from selectors that no longer match what the page renders.
  readonly unreadItemCount: number;
};

export const EMPTY_SCAN_STATS: ScanStats = {
  seenItemCount: 0,
  unreadItemCount: 0,
};

export function addScanStats(total: ScanStats, batch: ScanStats): ScanStats {
  return {
    seenItemCount: total.seenItemCount + batch.seenItemCount,
    unreadItemCount: total.unreadItemCount + batch.unreadItemCount,
  };
}

// What the counts mean for the scan, kept apart from how a popup says it: the
// wording belongs to the site, the reading of the numbers does not.
export type ScanStatsVerdict =
  // Nothing has been seen yet, so there is nothing to say.
  | 'quiet'
  | 'reading'
  // Reading is losing the race against the page recycling its own rows. Capture
  // is partial while this holds, and slowing the scan down is what helps.
  | 'racing'
  // Items are being found and none of them can be read. That is not a quiet
  // conversation, it is a parser that no longer matches the page.
  | 'unreadable';

// A quarter, because a scan that misses one item in four takes several passes to
// converge, which the user is better off knowing before exporting.
const RACING_UNREAD_SHARE = 0.25;

export function judgeScanStats(stats: ScanStats): ScanStatsVerdict {
  if (stats.seenItemCount === 0) {
    return 'quiet';
  }

  if (stats.unreadItemCount >= stats.seenItemCount) {
    return 'unreadable';
  }

  if (stats.unreadItemCount / stats.seenItemCount >= RACING_UNREAD_SHARE) {
    return 'racing';
  }

  return 'reading';
}
