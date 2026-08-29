// What the user can bound a scan by. A long thread is measured in hours, and no
// tuning removes that, so a scan is stoppable by date and by count rather than
// only by hand.
export type ScanOptions = {
  captureReactions: boolean;
  captureAttachments: boolean;
  // Scrolling stops once a message older than this is reached, which is what
  // makes "add the last month to an already-scanned thread" a bounded job.
  stopAtDate: string | null;
  stopAtMessageLimit: number | null;
};

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  captureReactions: true,
  captureAttachments: true,
  stopAtDate: null,
  stopAtMessageLimit: null,
};
