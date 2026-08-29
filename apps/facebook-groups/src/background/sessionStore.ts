import { createSessionStore } from '@extractor/capture-core/background';
import { captureSessionSchema } from '../shared/messaging/protocol';
import type { CaptureSession } from '../shared/types';
import { DEFAULT_CAPTURE_OPTIONS } from '../shared/types/captureOptions';

export const sessionStore = createSessionStore({
  sessionSchema: captureSessionSchema,
  defaultOptions: DEFAULT_CAPTURE_OPTIONS,
});

export function readCaptureSession(): Promise<CaptureSession> {
  return sessionStore.read();
}

export function writeCaptureSession(session: CaptureSession): Promise<void> {
  return sessionStore.write(session);
}

export function resetCaptureSession(): Promise<void> {
  return sessionStore.reset();
}
