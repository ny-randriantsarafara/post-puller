import { DEFAULT_CAPTURE_TIMING, type CaptureTiming } from './captureTiming';
import {
  createWindowScrollTarget,
  hasStalled,
  type ScrollPosition,
  type ScrollTarget,
} from './scrollTarget';

export type AutoScrollerCallbacks = {
  onExhausted: () => void;
};

export type AutoScrollerConfig = {
  readonly callbacks: AutoScrollerCallbacks;
  // Resolved per step rather than once, because a single-page app can replace
  // the scrolling element while a scan is running.
  readonly resolveScrollTarget?: () => ScrollTarget | null;
  readonly timing?: CaptureTiming;
};

export class AutoScroller {
  private readonly callbacks: AutoScrollerCallbacks;
  private readonly resolveScrollTarget: () => ScrollTarget | null;
  private readonly timing: CaptureTiming;
  private stepTimer: number | null = null;
  private lastPosition: ScrollPosition | null = null;
  private stalledStepCount = 0;
  private isActive = false;

  constructor({ callbacks, resolveScrollTarget, timing }: AutoScrollerConfig) {
    this.callbacks = callbacks;
    this.resolveScrollTarget = resolveScrollTarget ?? (() => createWindowScrollTarget());
    this.timing = timing ?? DEFAULT_CAPTURE_TIMING;
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
    }, this.timing.scrollDwellMs);
  }

  private runStep(): void {
    if (!this.isActive) {
      return;
    }

    // Timers are throttled to a crawl in a hidden tab, so a step taken there
    // says nothing about the list being exhausted.
    if (document.hidden) {
      this.scheduleStep();
      return;
    }

    const scrollTarget = this.resolveScrollTarget();
    if (scrollTarget === null) {
      this.finish();
      return;
    }

    const position = scrollTarget.readPosition();

    if (hasStalled(position, this.lastPosition)) {
      this.stalledStepCount += 1;

      if (this.stalledStepCount >= this.timing.stalledStepsBeforeStop) {
        this.finish();
        return;
      }
    } else {
      this.stalledStepCount = 0;
    }

    this.lastPosition = position;
    this.scrollOneStep(scrollTarget);
    this.scheduleStep();
  }

  private scrollOneStep(scrollTarget: ScrollTarget): void {
    const step = Math.max(
      this.timing.minScrollStepPx,
      Math.round(scrollTarget.readViewportHeight() * this.timing.scrollStepRatio),
    );

    scrollTarget.scrollByStep(step);
  }

  private finish(): void {
    this.stop();
    this.callbacks.onExhausted();
  }
}
