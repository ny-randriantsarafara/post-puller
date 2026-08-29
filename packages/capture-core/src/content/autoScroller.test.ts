import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoScroller } from './autoScroller';
import { createElementScrollTarget, createWindowScrollTarget } from './scrollTarget';

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

  it('keeps scrolling while the list keeps growing', async () => {
    const scroller = new AutoScroller({
      callbacks: {
        onExhausted: () => {
          throw new Error('The list was still growing');
        },
      },
    });

    scroller.start();

    // The site appends the next page once the bottom comes into view.
    for (let page = 0; page < 6; page += 1) {
      await vi.advanceTimersByTimeAsync(DWELL_MS);
      scrollHeight += 2000;
    }

    scroller.stop();

    expect(scrollCount).toBe(6);
    expect(scrollTop).toBeGreaterThan(0);
  });

  it('reports the list exhausted once scrolling stops changing the page', async () => {
    const exhaustedCalls = vi.fn();
    const scroller = new AutoScroller({ callbacks: { onExhausted: exhaustedCalls } });

    scroller.start();
    await vi.advanceTimersByTimeAsync(DWELL_MS * 10);

    expect(exhaustedCalls).toHaveBeenCalledTimes(1);
    expect(scrollTop).toBe(maxScrollTop());
  });

  it('stops scrolling for good once it reported an exhausted list', async () => {
    const scroller = new AutoScroller({ callbacks: { onExhausted: () => undefined } });

    scroller.start();
    await vi.advanceTimersByTimeAsync(DWELL_MS * 10);
    const scrollCountAtExhaustion = scrollCount;
    await vi.advanceTimersByTimeAsync(DWELL_MS * 10);

    expect(scrollCount).toBe(scrollCountAtExhaustion);
  });

  // Timers are throttled to about one per minute in a hidden tab, so steps taken
  // there would otherwise be counted as a list that stopped answering.
  it('never calls a hidden tab an exhausted list', async () => {
    const exhaustedCalls = vi.fn();
    const scroller = new AutoScroller({ callbacks: { onExhausted: exhaustedCalls } });

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
    const scroller = new AutoScroller({ callbacks: { onExhausted: () => undefined } });

    scroller.start();
    scroller.stop();
    await vi.advanceTimersByTimeAsync(DWELL_MS * 4);

    expect(scrollCount).toBe(0);
  });

  it('gives up when there is nothing to scroll', async () => {
    const exhaustedCalls = vi.fn();
    const scroller = new AutoScroller({
      resolveScrollTarget: () => null,
      callbacks: { onExhausted: exhaustedCalls },
    });

    scroller.start();
    await vi.advanceTimersByTimeAsync(DWELL_MS);

    expect(exhaustedCalls).toHaveBeenCalledTimes(1);
    expect(scrollCount).toBe(0);
  });
});

// Scrolling up is the case the offset projection exists for. A thread that
// prepends older messages while the browser holds the visual position moves
// scrollTop the wrong way, and a naive check would read the most productive step
// of all as a stall.
describe('AutoScroller scrolling up', () => {
  function createPanel(initialScrollTop: number, initialScrollHeight: number) {
    const element = document.createElement('div');
    const state = {
      scrollTop: initialScrollTop,
      scrollHeight: initialScrollHeight,
      scrollCount: 0,
    };

    Object.defineProperty(element, 'scrollTop', {
      configurable: true,
      get: () => state.scrollTop,
    });
    Object.defineProperty(element, 'scrollHeight', {
      configurable: true,
      get: () => state.scrollHeight,
    });
    Object.defineProperty(element, 'clientHeight', {
      configurable: true,
      get: () => 800,
    });

    element.scrollBy = (xOrOptions?: number | ScrollToOptions, y?: number) => {
      state.scrollCount += 1;
      const distance = typeof xOrOptions === 'number' ? (y ?? 0) : (xOrOptions?.top ?? 0);
      state.scrollTop = Math.max(0, state.scrollTop + distance);
    };

    return { element, state };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves toward the top of the panel', async () => {
    const { element, state } = createPanel(5000, 6000);
    const scroller = new AutoScroller({
      resolveScrollTarget: () => createElementScrollTarget(element, 'up'),
      callbacks: {
        onExhausted: () => {
          throw new Error('The panel had not reached its start');
        },
      },
    });

    scroller.start();
    await vi.advanceTimersByTimeAsync(DWELL_MS * 3);
    scroller.stop();

    expect(state.scrollCount).toBe(3);
    expect(state.scrollTop).toBeLessThan(5000);
  });

  it('counts prepended content as progress even when scrollTop jumps up', async () => {
    const { element, state } = createPanel(2000, 6000);
    const exhaustedCalls = vi.fn();
    const scroller = new AutoScroller({
      resolveScrollTarget: () => createElementScrollTarget(element, 'up'),
      callbacks: { onExhausted: exhaustedCalls },
    });

    scroller.start();

    // Scroll anchoring holds the visible messages in place, so prepending grows
    // scrollHeight and pushes scrollTop back down the document.
    for (let batch = 0; batch < 6; batch += 1) {
      await vi.advanceTimersByTimeAsync(DWELL_MS);
      state.scrollHeight += 3000;
      state.scrollTop += 3000;
    }

    scroller.stop();

    expect(exhaustedCalls).not.toHaveBeenCalled();
  });

  it('reports exhausted once the panel sits at its start', async () => {
    const { element } = createPanel(0, 6000);
    const exhaustedCalls = vi.fn();
    const scroller = new AutoScroller({
      resolveScrollTarget: () => createElementScrollTarget(element, 'up'),
      callbacks: { onExhausted: exhaustedCalls },
    });

    scroller.start();
    await vi.advanceTimersByTimeAsync(DWELL_MS * 10);

    expect(exhaustedCalls).toHaveBeenCalledTimes(1);
  });
});

describe('createWindowScrollTarget', () => {
  beforeEach(() => {
    stubPage(4000);
    scrollTop = 1000;
  });

  it('projects downward travel as the raw scroll offset', () => {
    expect(createWindowScrollTarget('down').readPosition()).toEqual({
      offset: 1000,
      extent: 4000,
    });
  });

  it('projects upward travel as the distance back from the end', () => {
    expect(createWindowScrollTarget('up').readPosition()).toEqual({
      offset: 3000,
      extent: 4000,
    });
  });
});
