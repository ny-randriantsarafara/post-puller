import {
  createElementScrollTarget,
  type ScrollTarget,
} from '@extractor/capture-core/content';
import { SELECTORS } from './parsing/selectors';

// Content taller than its box is not the same thing as a box that scrolls: an
// element with `overflow-y: visible` reports exactly the same scrollHeight and
// clientHeight, and one live conversation held 97 of them inside its log. Only
// the declared overflow separates the one element that answers to scrollBy.
const SCROLLABLE_OVERFLOW = /^(auto|scroll|overlay)$/;

function isScrollable(element: Element): boolean {
  if (!SCROLLABLE_OVERFLOW.test(window.getComputedStyle(element).overflowY)) {
    return false;
  }

  return element.scrollHeight > element.clientHeight + 1;
}

function holdsMessages(element: Element): boolean {
  return element.querySelector(SELECTORS.messageRow) !== null;
}

// Measured on a live conversation: the element that scrolls sits two levels
// below the log, so it cannot be found by walking upward. A region holding no
// messages - a picker, a sidebar - is not it, however well it scrolls.
function findScrollerWithin(log: Element): Element | null {
  const candidates = [log, ...log.querySelectorAll('*')];

  return (
    candidates.find(
      (candidate) => isScrollable(candidate) && holdsMessages(candidate),
    ) ?? null
  );
}

// Messenger has moved this element before, so an ancestor that scrolls is still
// accepted rather than assumed away.
function findScrollerAbove(log: Element): Element | null {
  for (let element = log.parentElement; element !== null; element = element.parentElement) {
    if (isScrollable(element)) {
      return element;
    }
  }

  return null;
}

export function resolveThreadScrollTarget(): ScrollTarget | null {
  const log = document.querySelector(SELECTORS.log);
  if (log === null) {
    return null;
  }

  const scroller = findScrollerWithin(log) ?? findScrollerAbove(log);
  if (scroller === null) {
    return null;
  }

  return createElementScrollTarget(scroller, 'up');
}
