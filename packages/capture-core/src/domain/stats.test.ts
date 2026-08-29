import { describe, expect, it } from 'vitest';
import { addScanStats, EMPTY_SCAN_STATS, judgeScanStats } from './stats';

describe('addScanStats', () => {
  it('adds a batch to the running totals', () => {
    expect(
      addScanStats(
        { seenItemCount: 10, unreadItemCount: 2 },
        { seenItemCount: 4, unreadItemCount: 1 },
      ),
    ).toEqual({ seenItemCount: 14, unreadItemCount: 3 });
  });
});

describe('judgeScanStats', () => {
  it('says nothing about a scan that has seen nothing', () => {
    expect(judgeScanStats(EMPTY_SCAN_STATS)).toBe('quiet');
  });

  it('reads a scan that misses a few items as reading', () => {
    expect(judgeScanStats({ seenItemCount: 100, unreadItemCount: 5 })).toBe('reading');
  });

  // A scan that misses one item in four needs several passes to converge, which
  // the user is better off knowing before they export the result.
  it('reads a scan that misses a quarter of what it sees as racing the page', () => {
    expect(judgeScanStats({ seenItemCount: 100, unreadItemCount: 25 })).toBe('racing');
  });

  // The state that matters most, because it is the one a selector change puts the
  // scan in, and the one an empty page is indistinguishable from without it.
  it('reads a scan that can read none of what it finds as unreadable', () => {
    expect(judgeScanStats({ seenItemCount: 12, unreadItemCount: 12 })).toBe(
      'unreadable',
    );
  });
});
