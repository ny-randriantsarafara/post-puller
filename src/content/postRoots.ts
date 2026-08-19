import { SELECTORS } from './parsing/selectors';

function isRenderedPostRoot(element: Element): boolean {
  if (!element.matches(SELECTORS.postRoot)) {
    return false;
  }

  return element.querySelector(SELECTORS.renderedPostContent) !== null;
}

// Comet empties a story once it scrolls out of the viewport, so an element found
// while it was rendered can be a bare placeholder by the time it is parsed.
export function isCapturablePostRoot(element: Element): boolean {
  return element.isConnected && isRenderedPostRoot(element);
}

export function findRenderedPostRoots(root: Element): Element[] {
  const candidates: Element[] = [];

  if (root.matches(SELECTORS.postRoot)) {
    candidates.push(root);
  }

  candidates.push(...root.querySelectorAll(SELECTORS.postRoot));
  return candidates.filter(isRenderedPostRoot);
}

export function findContainingPostRoot(node: Node | null): Element | null {
  if (node === null) {
    return null;
  }

  const element = node instanceof Element ? node : node.parentElement;
  if (element === null) {
    return null;
  }

  const postRoot = element.closest(SELECTORS.postRoot);
  if (postRoot === null || !isRenderedPostRoot(postRoot)) {
    return null;
  }

  return postRoot;
}
