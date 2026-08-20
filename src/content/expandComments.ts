import { readTrimmedText } from './parsing/domText';
import {
  SELECTORS,
  VIEW_MORE_COMMENTS_PATTERNS,
  VIEW_REPLIES_PATTERNS,
} from './parsing/selectors';

function matchesCommentExpansionPattern(label: string): boolean {
  const patterns = [...VIEW_MORE_COMMENTS_PATTERNS, ...VIEW_REPLIES_PATTERNS];
  return patterns.some((pattern) => pattern.test(label));
}

function isCommentExpansionControl(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  // Clicking a control nested in a link navigates away and interrupts capture.
  if (element.closest(SELECTORS.link) !== null) {
    return false;
  }

  const label = readTrimmedText(element);
  return matchesCommentExpansionPattern(label);
}

export function clickCommentExpansionControls(
  postElement: Element,
  remainingClickLimit: number,
): number {
  if (remainingClickLimit <= 0) {
    return 0;
  }

  const expansionControls = [
    ...postElement.querySelectorAll(SELECTORS.seeMoreButton),
  ].filter(isCommentExpansionControl);
  const controlsToClick = expansionControls.slice(0, remainingClickLimit);

  for (const control of controlsToClick) {
    control.click();
  }

  return controlsToClick.length;
}
