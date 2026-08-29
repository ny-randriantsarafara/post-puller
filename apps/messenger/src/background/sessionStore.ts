import { createSessionStore } from '@extractor/capture-core/background';
import { captureSessionSchema } from '../shared/messaging/protocol';
import { DEFAULT_SCAN_OPTIONS } from '../shared/types/scanOptions';

export const sessionStore = createSessionStore({
  sessionSchema: captureSessionSchema,
  defaultOptions: DEFAULT_SCAN_OPTIONS,
});
