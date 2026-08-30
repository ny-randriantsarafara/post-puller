import { describe, expect, it } from 'vitest';
import { resolvePageOffset } from './paging';

describe('resolvePageOffset', () => {
  it('lands on the start of the page the item sits on', () => {
    expect(resolvePageOffset(45, 20, 100)).toBe(40);
  });

  it('stays on the first page for an item on it', () => {
    expect(resolvePageOffset(7, 20, 100)).toBe(0);
  });

  // The case the clamp exists for: a date after the last item counts every item
  // as ahead of it, and 40 divides by 20 exactly.
  it('stops at the last page rather than one past the end', () => {
    expect(resolvePageOffset(40, 20, 40)).toBe(20);
  });

  it('stays at the start when nothing is stored', () => {
    expect(resolvePageOffset(0, 20, 0)).toBe(0);
  });

  // A filtered read has walked as far as it was asked to and no further, so it
  // has no total to clamp against.
  it('trusts the count when the total is unknown', () => {
    expect(resolvePageOffset(40, 20, null)).toBe(40);
  });
});
