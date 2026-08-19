import { readTrimmedText } from './parsing/domText';
import { SEE_MORE_PATTERNS, SELECTORS } from './parsing/selectors';

function isTextExpansionControl(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  // Clicking a control nested in a link navigates to the post permalink, which
  // unloads the content script and interrupts the whole capture session.
  if (element.closest(SELECTORS.link) !== null) {
    return false;
  }

  const label = readTrimmedText(element);
  return SEE_MORE_PATTERNS.some((pattern) => pattern.test(label));
}

export function clickPostTextExpansionControls(
  postElement: Element,
  remainingClickLimit: number,
): number {
  if (remainingClickLimit <= 0) {
    return 0;
  }

  const messageContainers = postElement.querySelectorAll(SELECTORS.postMessage);
  const expansionControls = [...messageContainers].flatMap((messageContainer) =>
    [...messageContainer.querySelectorAll(SELECTORS.seeMoreButton)].filter(
      isTextExpansionControl,
    ),
  );
  const controlsToClick = expansionControls.slice(0, remainingClickLimit);

  for (const control of controlsToClick) {
    control.click();
  }

  return controlsToClick.length;
}
