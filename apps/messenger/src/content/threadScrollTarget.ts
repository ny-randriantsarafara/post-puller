import {
  createElementScrollTarget,
  type ScrollTarget,
} from '@extractor/capture-core/content';
import { SELECTORS } from './parsing/selectors';

// The log itself does not scroll. The element that does is an ancestor, and
// which one cannot be known offline, so it is found by looking for the nearest
// ancestor that actually overflows.
export function resolveThreadScrollTarget(): ScrollTarget | null {
  const log = document.querySelector(SELECTORS.log);
  if (log === null) {
    return null;
  }

  for (let element = log; element.parentElement !== null; ) {
    if (element.scrollHeight > element.clientHeight + 1) {
      return createElementScrollTarget(element, 'up');
    }
    element = element.parentElement;
  }

  return null;
}
