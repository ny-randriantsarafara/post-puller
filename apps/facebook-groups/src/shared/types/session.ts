import {
  buildEmptyCaptureSession,
  type CaptureSession as CoreCaptureSession,
} from '@extractor/capture-core/messaging';
import type { CaptureOptions } from './captureOptions';
import { DEFAULT_CAPTURE_OPTIONS } from './captureOptions';

export type { CaptureMode, CaptureStatus } from '@extractor/capture-core/messaging';

export type CaptureSession = CoreCaptureSession<CaptureOptions>;

export const EMPTY_CAPTURE_SESSION: CaptureSession =
  buildEmptyCaptureSession(DEFAULT_CAPTURE_OPTIONS);
