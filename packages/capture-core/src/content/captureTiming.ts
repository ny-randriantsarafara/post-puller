// Grouped in one place because the scroller's dwell has to outlast the
// observer's flush deadline. When these lived in two modules the scroller had to
// import the observer to read one constant, which put the whole observer in the
// module graph of anything that only wanted to scroll.
export type CaptureTiming = {
  readonly debounceMs: number;
  // Scrolling produces a continuous mutation stream, so a plain debounce would
  // keep postponing capture until scrolling stops. By then the site has emptied
  // the items that scrolled past. This bounds that delay.
  readonly maxFlushWaitMs: number;
  readonly rootRecheckMs: number;
  readonly batchSize: number;
  readonly scrollDwellMs: number;
  // A step shorter than the viewport keeps every item on screen for at least one
  // dwell, so scrolling stays behind capture rather than racing it.
  readonly scrollStepRatio: number;
  readonly minScrollStepPx: number;
  // A site often needs a couple of steps at the edge before the next page
  // arrives, so a single stalled step is not enough to call the list exhausted.
  readonly stalledStepsBeforeStop: number;
};

export const DEFAULT_CAPTURE_TIMING: CaptureTiming = {
  debounceMs: 400,
  maxFlushWaitMs: 1000,
  rootRecheckMs: 2000,
  batchSize: 20,
  scrollDwellMs: 1500,
  scrollStepRatio: 0.7,
  minScrollStepPx: 200,
  stalledStepsBeforeStop: 4,
};
