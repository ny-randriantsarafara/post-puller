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
async function refreshCanonicalThreadId(threadId: string): Promise<void> {
  const response: unknown = await chrome.runtime.sendMessage({
    type: 'RESOLVE_CANONICAL_THREAD_ID',
    candidateIds: [threadId],
  });

  const parsed = threadResponseSchema.safeParse(response);
  if (!parsed.success || parsed.data.type !== 'CANONICAL_THREAD_ID') {
    return;
  }

  scan.setCanonicalThreadId(threadId, parsed.data.threadId);
}

// The extension can be reloaded while this script still runs in the page, which
// rejects the message rather than answering it. The scan falls back to the id in
// the URL, which is the right answer for a thread never captured before.
function requestCanonicalThreadId(threadId: string): void {
  void refreshCanonicalThreadId(threadId).catch(() => undefined);
}

// Messenger switches conversation by pushState, which fires no event a page can
// listen for: `popstate` covers only the back and forward buttons. The id in the
// URL is therefore polled, so that opening a second conversation asks about that
// conversation rather than leaving the answer about the first one in place.
const THREAD_CHANGE_POLL_MS = 1000;

export function initializeCaptureController(): void {
  controller.initialize();

  let lastThreadId: string | null = null;

  function checkForThreadChange(): void {
    const threadId = resolveThreadTarget().threadId;
    if (threadId === lastThreadId) {
      return;
    }

    lastThreadId = threadId;

    if (threadId !== null) {
      requestCanonicalThreadId(threadId);
    }
  }

  checkForThreadChange();
  window.setInterval(checkForThreadChange, THREAD_CHANGE_POLL_MS);
}

export const handleContentMessage = controller.handleContentMessage;
