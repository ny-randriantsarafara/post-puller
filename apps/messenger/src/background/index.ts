import { toErrorMessage } from '@extractor/capture-core/errorMessage';
import { capturedMessageSchema } from '../shared/messaging/protocol';
import { messageRepository } from '../shared/storage/messageRepository';
import type { ScanStopReason } from '../shared/types/thread';
import { handleBackgroundMessage, registerLifecycleHandlers } from './captureCoordinator';
import {
  handleThreadRequest,
  parseThreadRequest,
  recordThreadScan,
} from './threadHandlers';

registerLifecycleHandlers();

// Which capture messages carry news about the thread, and what a scan that ended
// on each of them actually reached. A batch mid-scan reports no reason at all,
// so live counts are recorded without claiming an outcome.
//
// AUTO_SCROLL_COMPLETED is deliberately absent. Scrolling that ran out says
// nothing about whether the conversation is at its first message or merely
// stopped answering, and only the page can tell those apart, so the content
// script reports that outcome itself with RECORD_THREAD_SCAN.
const STOP_REASON_BY_MESSAGE_TYPE: Record<string, ScanStopReason | null> = {
  ITEMS_CAPTURED: null,
  STOP_CAPTURE: 'userLimit',
  CAPTURE_INTERRUPTED: 'interrupted',
};

function readMessageType(message: unknown): string | null {
  if (typeof message !== 'object' || message === null) {
    return null;
  }

  const type = (message as { type?: unknown }).type;
  return typeof type === 'string' ? type : null;
}

// The thread a batch belongs to is carried by the messages themselves, which is
// the only place it is reliable: a service worker can be restarted between two
// batches of the same scan, so nothing can be remembered between them.
function readThreadIdFromItems(message: unknown): string | null {
  if (typeof message !== 'object' || message === null) {
    return null;
  }

  const items = (message as { items?: unknown }).items;
  if (!Array.isArray(items)) {
    return null;
  }

  for (const item of items) {
    const parsed = capturedMessageSchema.safeParse(item);
    if (parsed.success) {
      return parsed.data.threadId;
    }
  }

  return null;
}

async function readActiveThreadId(): Promise<string | null> {
  const threads = await messageRepository.listThreads();
  const mostRecent = [...threads].sort((left, right) =>
    right.lastScannedAt.localeCompare(left.lastScannedAt),
  );

  return mostRecent[0]?.threadId ?? null;
}

async function recordThreadProgress(message: unknown): Promise<void> {
  const messageType = readMessageType(message);
  if (messageType === null || !(messageType in STOP_REASON_BY_MESSAGE_TYPE)) {
    return;
  }

  const threadId = readThreadIdFromItems(message) ?? (await readActiveThreadId());
  if (threadId === null) {
    return;
  }

  await recordThreadScan({
    threadId,
    stopReason: STOP_REASON_BY_MESSAGE_TYPE[messageType] ?? null,
  });
}

// Messenger's own requests are tried first; anything else is a capture message
// the generic coordinator owns.
async function handleMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const threadRequest = parseThreadRequest(message);
  if (threadRequest !== null) {
    return handleThreadRequest(threadRequest);
  }

  const response = await handleBackgroundMessage(message, sender);

  // After the coordinator, so the message count reconciled from the store
  // includes the batch that has just been written.
  await recordThreadProgress(message);

  return response;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Always answering keeps the popup from parsing an undefined response when a
  // handler fails.
  void handleMessage(message, sender).then(sendResponse, (error: unknown) => {
    sendResponse({ type: 'ERROR', message: toErrorMessage(error) });
  });

  return true;
});
