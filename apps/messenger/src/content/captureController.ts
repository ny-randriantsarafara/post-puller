import { createCaptureController } from '@extractor/capture-core/content';
import { captureProtocol } from '../shared/messaging/protocol';
import { threadResponseSchema } from '../shared/messaging/threadRequests';
import { DEFAULT_SCAN_OPTIONS } from '../shared/types/scanOptions';
import { createMessengerSiteAdapter } from './messengerSiteAdapter';
import { resolveThreadTarget } from './threadPage';
import { createThreadScan } from './threadScan';

const scan = createThreadScan();

const controller = createCaptureController({
  adapter: createMessengerSiteAdapter(scan),
  protocol: captureProtocol,
  defaultOptions: DEFAULT_SCAN_OPTIONS,
});

// Which id the thread's records are keyed under is a storage question, and a
// content script's indexedDB belongs to the page rather than the extension, so
// the answer has to come from the service worker. It is asked for as soon as a
// thread is on screen, well before the user can start a scan.
async function refreshCanonicalThreadId(): Promise<void> {
  const target = resolveThreadTarget();
  if (target.threadId === null) {
    scan.setCanonicalThreadId(null);
    return;
  }

  const response: unknown = await chrome.runtime.sendMessage({
    type: 'RESOLVE_CANONICAL_THREAD_ID',
    candidateIds: [target.threadId],
  });

  const parsed = threadResponseSchema.safeParse(response);
  if (!parsed.success || parsed.data.type !== 'CANONICAL_THREAD_ID') {
    return;
  }

  scan.setCanonicalThreadId(parsed.data.threadId);
}

// The extension can be reloaded while this script still runs in the page, which
// rejects the message rather than answering it. The adapter falls back to the id
// in the URL, which is the right answer for a thread never captured before.
function requestCanonicalThreadId(): void {
  void refreshCanonicalThreadId().catch(() => {
    scan.setCanonicalThreadId(null);
  });
}

export function initializeCaptureController(): void {
  controller.initialize();
  requestCanonicalThreadId();

  // Messenger moves between conversations without a document load, so the thread
  // can change under a content script that is already running.
  window.addEventListener('popstate', requestCanonicalThreadId);
}

export const handleContentMessage = controller.handleContentMessage;
