export type ScrollDirection = 'down' | 'up';

// Position is projected as distance already travelled in the direction of
// travel, plus the total extent. That projection is what lets one stall check
// serve both directions.
//
// Scrolling up matters here. When a thread prepends older messages, the
// browser's scroll anchoring holds the visual position, so scrollTop jumps
// upward on the most productive step of all; a `scrollTop <= previous` check
// would read that as stalled. Measuring `scrollHeight - scrollTop` instead makes
// prepended content register as progress either way, and reaching the top
// freezes both numbers, which is the only real stall.
export type ScrollPosition = {
  offset: number;
  extent: number;
};

export type ScrollTarget = {
  readPosition: () => ScrollPosition;
  scrollByStep: (distance: number) => void;
  readViewportHeight: () => number;
  // Whether the target sits at the end of its direction of travel. A stall says
  // only that the last step achieved nothing, which is equally true of a list
  // that stopped answering; this is what separates the two.
  hasReachedEnd: () => boolean;
};

// A few pixels of slack, because a scroll offset is fractional on a zoomed or
// high-density display and rarely lands exactly on the end.
const END_TOLERANCE_PX = 4;

function hasReachedEnd(
  direction: ScrollDirection,
  scrollTop: number,
  scrollHeight: number,
  viewportHeight: number,
): boolean {
  if (direction === 'up') {
    return scrollTop <= END_TOLERANCE_PX;
  }

  return scrollTop + viewportHeight >= scrollHeight - END_TOLERANCE_PX;
}

function projectOffset(
  direction: ScrollDirection,
  scrollTop: number,
  scrollHeight: number,
): number {
  if (direction === 'down') {
    return scrollTop;
  }

  return scrollHeight - scrollTop;
}

function signedDistance(direction: ScrollDirection, distance: number): number {
  if (direction === 'down') {
    return distance;
  }

  return -distance;
}

export function createWindowScrollTarget(
  direction: ScrollDirection = 'down',
): ScrollTarget {
  return {
    readPosition: () => {
      const scroller = document.scrollingElement ?? document.documentElement;

      return {
        offset: projectOffset(direction, scroller.scrollTop, scroller.scrollHeight),
        extent: scroller.scrollHeight,
      };
    },
    scrollByStep: (distance) => {
      window.scrollBy(0, signedDistance(direction, distance));
    },
    readViewportHeight: () => window.innerHeight,
    hasReachedEnd: () => {
      const scroller = document.scrollingElement ?? document.documentElement;

      return hasReachedEnd(
        direction,
        scroller.scrollTop,
        scroller.scrollHeight,
        window.innerHeight,
      );
    },
  };
}

export function createElementScrollTarget(
  element: Element,
  direction: ScrollDirection = 'down',
): ScrollTarget {
  return {
    readPosition: () => ({
      offset: projectOffset(direction, element.scrollTop, element.scrollHeight),
      extent: element.scrollHeight,
    }),
    scrollByStep: (distance) => {
      element.scrollBy(0, signedDistance(direction, distance));
    },
    readViewportHeight: () => element.clientHeight,
    hasReachedEnd: () =>
      hasReachedEnd(
        direction,
        element.scrollTop,
        element.scrollHeight,
        element.clientHeight,
      ),
  };
}

// The list is done when the last step neither moved the target nor made it
// longer, which covers both the end of the list and a list that stopped
// answering.
export function hasStalled(
  position: ScrollPosition,
  previousPosition: ScrollPosition | null,
): boolean {
  if (previousPosition === null) {
    return false;
  }

  return (
    position.offset <= previousPosition.offset &&
    position.extent <= previousPosition.extent
  );
}
