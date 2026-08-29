import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveThreadScrollTarget } from './threadScrollTarget';

type ScrollMetrics = {
  scrollHeight: number;
  clientHeight: number;
  scrollTop?: number;
};

// jsdom performs no layout, so the three numbers that decide what scrolls have
// to be supplied. Everything else about the shape is real markup.
function setScrollMetrics(element: Element, metrics: ScrollMetrics): void {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => metrics.clientHeight,
  });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    value: metrics.scrollTop ?? 0,
    writable: true,
  });
}

function query(selector: string): Element {
  const element = document.querySelector(selector);
  if (element === null) {
    throw new Error(`The fixture is missing ${selector}`);
  }

  return element;
}

// The shape measured on a live conversation: the element that scrolls sits two
// levels *below* the log, and the log itself does not scroll.
function renderLiveThreadShape(): void {
  document.body.innerHTML = `
    <div id="outer">
      <div role="log" aria-label="Messages in conversation with Alex Moreau">
        <div id="wrapper">
          <div id="scroller" role="none" style="overflow-y: auto">
            <div role="article">
              <div data-message-id="mid.$one" aria-roledescription="message"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  setScrollMetrics(query('#outer'), { scrollHeight: 700, clientHeight: 700 });
  setScrollMetrics(query('[role="log"]'), { scrollHeight: 550, clientHeight: 550 });
  setScrollMetrics(query('#wrapper'), { scrollHeight: 550, clientHeight: 550 });
  setScrollMetrics(query('#scroller'), {
    scrollHeight: 2168,
    clientHeight: 550,
    scrollTop: 1618,
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('resolveThreadScrollTarget', () => {
  it('finds the element that scrolls inside the log', () => {
    renderLiveThreadShape();

    const target = resolveThreadScrollTarget();

    expect(target).not.toBeNull();
    expect(target?.readPosition().extent).toBe(2168);
    expect(target?.readViewportHeight()).toBe(550);
  });

  it('drives the element that scrolls, upward', () => {
    renderLiveThreadShape();
    const scroller = query('#scroller');
    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy;

    resolveThreadScrollTarget()?.scrollByStep(300);

    expect(scrollBy).toHaveBeenCalledWith(0, -300);
  });

  // An element whose content is taller than its box reports the same
  // scrollHeight and clientHeight as one that scrolls, and Messenger's rows are
  // full of them. Driving one does nothing at all, which is what stopped
  // automatic scanning from moving.
  it('ignores an element that overflows without scrolling', () => {
    document.body.innerHTML = `
      <div role="log" aria-label="Messages in conversation with Alex Moreau">
        <div id="clipped" style="overflow-y: visible">
          <div role="article">
            <div data-message-id="mid.$one" aria-roledescription="message"></div>
          </div>
        </div>
      </div>
    `;
    setScrollMetrics(query('[role="log"]'), { scrollHeight: 550, clientHeight: 550 });
    setScrollMetrics(query('#clipped'), { scrollHeight: 4036, clientHeight: 4009 });

    expect(resolveThreadScrollTarget()).toBeNull();
  });

  // Messenger has moved this element before, so an ancestor that scrolls is
  // still accepted rather than assumed away.
  it('falls back to an ancestor that scrolls', () => {
    document.body.innerHTML = `
      <div id="panel" style="overflow-y: auto">
        <div role="log" aria-label="Messages in conversation with Alex Moreau">
          <div role="article">
            <div data-message-id="mid.$one" aria-roledescription="message"></div>
          </div>
        </div>
      </div>
    `;
    setScrollMetrics(query('[role="log"]'), { scrollHeight: 2000, clientHeight: 2000 });
    setScrollMetrics(query('#panel'), { scrollHeight: 2000, clientHeight: 600 });

    const target = resolveThreadScrollTarget();

    expect(target?.readPosition().extent).toBe(2000);
    expect(target?.readViewportHeight()).toBe(600);
  });

  // The conversation opens on its newest message, so a scrollable region
  // holding no messages - a picker, a sidebar - must not be mistaken for it.
  it('ignores a scrollable region that holds no messages', () => {
    document.body.innerHTML = `
      <div role="log" aria-label="Messages in conversation with Alex Moreau">
        <div id="picker" role="none" style="overflow-y: auto"></div>
        <div id="scroller" role="none" style="overflow-y: auto">
          <div role="article">
            <div data-message-id="mid.$one" aria-roledescription="message"></div>
          </div>
        </div>
      </div>
    `;
    setScrollMetrics(query('[role="log"]'), { scrollHeight: 550, clientHeight: 550 });
    setScrollMetrics(query('#picker'), { scrollHeight: 900, clientHeight: 200 });
    setScrollMetrics(query('#scroller'), { scrollHeight: 2168, clientHeight: 550 });

    expect(resolveThreadScrollTarget()?.readPosition().extent).toBe(2168);
  });

  it('returns null when the conversation has nothing to scroll', () => {
    document.body.innerHTML = `
      <div role="log" aria-label="Messages in conversation with Alex Moreau">
        <div role="article">
          <div data-message-id="mid.$one" aria-roledescription="message"></div>
        </div>
      </div>
    `;
    setScrollMetrics(query('[role="log"]'), { scrollHeight: 550, clientHeight: 550 });

    expect(resolveThreadScrollTarget()).toBeNull();
  });

  it('returns null when no conversation is open', () => {
    document.body.innerHTML = '<div id="empty"></div>';

    expect(resolveThreadScrollTarget()).toBeNull();
  });
});
