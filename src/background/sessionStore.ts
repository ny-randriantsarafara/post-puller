import { EMPTY_CAPTURE_SESSION, type CaptureSession } from '../shared/types';
import { captureSessionSchema } from '../shared/messaging/protocol';

const SESSION_STORAGE_KEY = 'captureSession';

export async function readCaptureSession(): Promise<CaptureSession> {
  const stored = await chrome.storage.local.get(SESSION_STORAGE_KEY);
  const rawValue = stored[SESSION_STORAGE_KEY];

  if (rawValue === undefined) {
    return EMPTY_CAPTURE_SESSION;
  }

  return captureSessionSchema.parse(rawValue);
}

export async function writeCaptureSession(session: CaptureSession): Promise<void> {
  await chrome.storage.local.set({
    [SESSION_STORAGE_KEY]: session,
  });
}

export async function resetCaptureSession(): Promise<void> {
  await writeCaptureSession(EMPTY_CAPTURE_SESSION);
}
