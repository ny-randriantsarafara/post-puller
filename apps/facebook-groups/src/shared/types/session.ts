import type { CollectionCaptureStats } from '../stats/collectionStats';
import type { CaptureOptions } from './captureOptions';
import { DEFAULT_CAPTURE_OPTIONS } from './captureOptions';

export type CaptureStatus = 'idle' | 'capturing' | 'interrupted';

export type CaptureMode = 'manual' | 'auto';

export type CaptureSession = {
  status: CaptureStatus;
  mode: CaptureMode;
  options: CaptureOptions;
  // Set when auto-scroll gave up because the feed stopped yielding new content.
  // Capture keeps running, so anything Facebook loads afterwards is still stored.
  autoScrollCompletedAt: string | null;
  tabId: number | null;
  collectionUrl: string | null;
  collectionName: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  interruptedAt: string | null;
  collectionStats: CollectionCaptureStats[];
};

export const EMPTY_CAPTURE_SESSION: CaptureSession = {
  status: 'idle',
  mode: 'manual',
  options: DEFAULT_CAPTURE_OPTIONS,
  autoScrollCompletedAt: null,
  tabId: null,
  collectionUrl: null,
  collectionName: null,
  startedAt: null,
  stoppedAt: null,
  interruptedAt: null,
  collectionStats: [],
};
