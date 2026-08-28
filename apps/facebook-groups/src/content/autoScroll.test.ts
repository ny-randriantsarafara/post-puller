import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoScroller } from './autoScroll';

const DWELL_MS = 1500;

let scrollTop = 0;
let scrollHeight = 0;
let scrollCount = 0;
let isTabHidden = false;

function maxScrollTop(): number {
  return Math.max(0, scrollHeight - window.innerHeight);
}

function resolveScrollOffset(xOrOptions?: number | ScrollToOptions, y?: number): number {
  if (typeof xOrOptions === 'number') {
    return y ?? 0;
  }

  return xOrOptions?.top ?? 0;
}

function simulateScrollBy(xOrOptions?: number | ScrollToOptions, y?: number): void {
  scrollCount += 1;
  scrollTop = Math.min(scrollTop + resolveScrollOffset(xOrOptions, y), maxScrollTop());
}

function stubPage(pageHeight: number): void {
  scrollTop = 0;
  scrollHeight = pageHeight;
  scrollCount = 0;
  isTabHidden = false;

  Object.defineProperty(document.documentElement, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
  });
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => isTabHidden,
  });

  window.scrollBy = simulateScrollBy;
}

describe('AutoScroller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubPage(1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps scrolling while the feed keeps growing', async () => {
    const scroller = new AutoScroller({
      onFeedExhausted: () => {
        throw new Error('The feed was still growing');
      },
    });

    scroller.start();

    // Facebook appends the next page once the bottom comes into view.
    for (let page = 0; page < 6; page += 1) {
      await vi.advanceTimersByTimeAsync(DWELL_MS);
      scrollHeight += 2000;
    }

    scroller.stop();

    expect(scrollCount).toBe(6);
    expect(scrollTop).toBeGreaterThan(0);
  });

  it('reports the feed exhausted once scrolling stops changing the page', async () => {
    const exhaustedCalls = vi.fn();
    const scroller = new AutoScroller({ onFeedExhausted: exhaustedCalls });

    scroller.start();
    await vi.advanceTimersByTimeAsync(DWELL_MS * 10);

    expect(exhaustedCalls).toHaveBeenCalledTimes(1);
    expect(scrollTop).toBe(maxScrollTop());
  });

  it('stops scrolling for good once it reported an exhausted feed', async () => {
    const scroller = new AutoScroller({ onFeedExhausted: () => undefined });

    scroller.start();
    await vi.advanceTimersByTimeAsync(DWELL_MS * 10);
    const scrollCountAtExhaustion = scrollCount;
    await vi.advanceTimersByTimeAsync(DWELL_MS * 10);

    expect(scrollCount).toBe(scrollCountAtExhaustion);
  });

  // Timers are throttled to about one per minute in a hidden tab, so steps taken
  // there would otherwise be counted as a feed that stopped answering.
  it('never calls a hidden tab an exhausted feed', async () => {
    const exhaustedCalls = vi.fn();
    const scroller = new AutoScroller({ onFeedExhausted: exhaustedCalls });

    isTabHidden = true;
    scroller.start();
    await vi.advanceTimersByTimeAsync(DWELL_MS * 10);

    expect(exhaustedCalls).not.toHaveBeenCalled();
    expect(scrollCount).toBe(0);

    isTabHidden = false;
    await vi.advanceTimersByTimeAsync(DWELL_MS);

    expect(scrollCount).toBe(1);
  });

  it('stops on request', async () => {
    const scroller = new AutoScroller({ onFeedExhausted: () => undefined });

    scroller.start();
    scroller.stop();
    await vi.advanceTimersByTimeAsync(DWELL_MS * 4);

    expect(scrollCount).toBe(0);
  });
});
