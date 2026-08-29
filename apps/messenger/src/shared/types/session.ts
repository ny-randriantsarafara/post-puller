import {
  buildEmptyCaptureSession,
  type CaptureSession as CoreCaptureSession,
} from '@extractor/capture-core/messaging';
import type { ScanOptions } from './scanOptions';
import { DEFAULT_SCAN_OPTIONS } from './scanOptions';

export type { CaptureMode, CaptureStatus } from '@extractor/capture-core/messaging';

export type CaptureSession = CoreCaptureSession<ScanOptions>;

export const EMPTY_CAPTURE_SESSION: CaptureSession =
  buildEmptyCaptureSession(DEFAULT_SCAN_OPTIONS);
