import type { GroupCaptureStats } from '../stats/groupStats';

export type CaptureStatus = 'idle' | 'capturing' | 'interrupted';

export type CaptureMode = 'manual' | 'auto';

export type CaptureSession = {
  status: CaptureStatus;
  mode: CaptureMode;
  // Set when auto-scroll gave up because the feed stopped yielding new content.
  // Capture keeps running, so anything Facebook loads afterwards is still stored.
  autoScrollCompletedAt: string | null;
  tabId: number | null;
  groupUrl: string | null;
  groupName: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  interruptedAt: string | null;
  groupStats: GroupCaptureStats[];
};

export const EMPTY_CAPTURE_SESSION: CaptureSession = {
  status: 'idle',
  mode: 'manual',
  autoScrollCompletedAt: null,
  tabId: null,
  groupUrl: null,
  groupName: null,
  startedAt: null,
  stoppedAt: null,
  interruptedAt: null,
  groupStats: [],
};
