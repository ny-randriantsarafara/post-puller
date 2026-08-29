import type { Schema } from '../domain/schema';
import {
  buildEmptyCaptureSession,
  type CaptureSession,
} from '../messaging/session';

const SESSION_STORAGE_KEY = 'captureSession';

export type SessionStore<TOptions extends object> = {
  readonly emptySession: CaptureSession<TOptions>;
  read: () => Promise<CaptureSession<TOptions>>;
  write: (session: CaptureSession<TOptions>) => Promise<void>;
  reset: () => Promise<void>;
};

export type SessionStoreConfig<TOptions extends object> = {
  readonly sessionSchema: Schema<CaptureSession<TOptions>>;
  readonly defaultOptions: TOptions;
};

export function createSessionStore<TOptions extends object>({
  sessionSchema,
  defaultOptions,
}: SessionStoreConfig<TOptions>): SessionStore<TOptions> {
  const emptySession = buildEmptyCaptureSession(defaultOptions);

  async function write(session: CaptureSession<TOptions>): Promise<void> {
    await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session });
  }

  return {
    emptySession,
    write,
    reset: () => write(emptySession),
    read: async () => {
      const stored = await chrome.storage.local.get(SESSION_STORAGE_KEY);
      const rawValue = stored[SESSION_STORAGE_KEY];

      if (rawValue === undefined) {
        return emptySession;
      }

      return sessionSchema.parse(rawValue);
    },
  };
}
