import { MAX_FLUSH_WAIT_MS } from './feedObserver';

// Facebook empties a post as soon as it leaves the viewport, so scrolling has to
// stay behind capture rather than race it. A step shorter than the viewport keeps
// every post on screen for at least one dwell, and the dwell outlasts the worst
// case the feed observer needs to store what it has found.
const SCROLL_STEP_RATIO = 0.7;
const MIN_SCROLL_STEP_PX = 200;
const DWELL_MS = MAX_FLUSH_WAIT_MS + 500;

// Facebook often needs a couple of steps at the bottom before the next page
// arrives, so a single stalled step is not enough to call the feed exhausted.
const STALLED_STEPS_BEFORE_STOP = 4;

type FeedPosition = {
  scrollTop: number;
  scrollHeight: number;
};

export type AutoScrollerCallbacks = {
  onFeedExhausted: () => void;
};

export class AutoScroller {
  private readonly callbacks: AutoScrollerCallbacks;
  private stepTimer: number | null = null;
  private lastPosition: FeedPosition | null = null;
  private stalledStepCount = 0;
  private isActive = false;

  constructor(callbacks: AutoScrollerCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.isActive) {
      return;
    }

    this.isActive = true;
    this.lastPosition = null;
    this.stalledStepCount = 0;
    this.scheduleStep();
  }

  stop(): void {
    this.isActive = false;

    if (this.stepTimer !== null) {
      window.clearTimeout(this.stepTimer);
      this.stepTimer = null;
    }

    this.lastPosition = null;
    this.stalledStepCount = 0;
  }

  private scheduleStep(): void {
    this.stepTimer = window.setTimeout(() => {
      this.runStep();
    }, DWELL_MS);
  }

  private runStep(): void {
    if (!this.isActive) {
      return;
    }

    // Timers are throttled to a crawl in a hidden tab, so a step taken there
    // says nothing about the feed being exhausted.
    if (document.hidden) {
      this.scheduleStep();
      return;
    }

    const position = this.readPosition();

    if (this.hasStalled(position)) {
      this.stalledStepCount += 1;

      if (this.stalledStepCount >= STALLED_STEPS_BEFORE_STOP) {
        this.finish();
        return;
      }
    } else {
      this.stalledStepCount = 0;
    }

    this.lastPosition = position;
    this.scrollOneStep();
    this.scheduleStep();
  }

  // The feed is done when the last step neither moved the page nor made it
  // longer, which covers both the end of the feed and a feed that stopped
  // answering.
  private hasStalled(position: FeedPosition): boolean {
    const previousPosition = this.lastPosition;
    if (previousPosition === null) {
      return false;
    }

    return (
      position.scrollTop <= previousPosition.scrollTop &&
      position.scrollHeight <= previousPosition.scrollHeight
    );
  }

  private readPosition(): FeedPosition {
    const scroller = document.scrollingElement ?? document.documentElement;

    return {
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
    };
  }

  private scrollOneStep(): void {
    const step = Math.max(
      MIN_SCROLL_STEP_PX,
      Math.round(window.innerHeight * SCROLL_STEP_RATIO),
    );

    window.scrollBy(0, step);
  }

  private finish(): void {
    this.stop();
    this.callbacks.onFeedExhausted();
  }
}
