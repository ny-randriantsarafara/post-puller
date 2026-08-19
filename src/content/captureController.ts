import type { CaptureMode, CapturedPost } from '../shared/types';
import {
  parseContentRequest,
  type BackgroundRequest,
  type ContentRequest,
} from '../shared/messaging/protocol';
import { trySendBackgroundRequest } from '../shared/messaging/client';
import { AutoScroller } from './autoScroll';
import { FeedObserver } from './feedObserver';
import { getGroupPageInfo } from './groupPage';

let isCapturing = false;
let feedObserver: FeedObserver | null = null;
let autoScroller: AutoScroller | null = null;

// The extension can be reloaded or removed while this script still runs in the
// page. Capture then stops instead of leaving rejected promises behind.
function notifyBackground(request: BackgroundRequest): void {
  void trySendBackgroundRequest(request).then((result) => {
    if (result.ok) {
      return;
    }

    endCapture();
  });
}

function ensureFeedObserver(): FeedObserver {
  if (feedObserver !== null) {
    return feedObserver;
  }

  feedObserver = new FeedObserver({
    onPostsCaptured: (posts: CapturedPost[]) => {
      notifyBackground({
        type: 'POSTS_CAPTURED',
        tabId: 0,
        posts,
      });
    },
    onInterrupted: () => {
      isCapturing = false;
      ensureAutoScroller().stop();
    },
  });

  return feedObserver;
}

function ensureAutoScroller(): AutoScroller {
  if (autoScroller !== null) {
    return autoScroller;
  }

  // Scrolling stops, but capture stays on so that anything Facebook loads
  // afterwards is still stored.
  autoScroller = new AutoScroller({
    onFeedExhausted: () => {
      notifyBackground({
        type: 'AUTO_SCROLL_COMPLETED',
        tabId: 0,
      });
    },
  });

  return autoScroller;
}

function beginCapture(mode: CaptureMode): void {
  const pageInfo = getGroupPageInfo();
  if (!pageInfo.isGroupPage) {
    return;
  }

  isCapturing = true;
  ensureFeedObserver().start();

  if (mode === 'auto') {
    ensureAutoScroller().start();
  }
}

function endCapture(): void {
  isCapturing = false;
  ensureFeedObserver().stop();
  ensureAutoScroller().stop();
}

function handleNavigationChange(): void {
  if (!isCapturing) {
    return;
  }

  const pageInfo = getGroupPageInfo();
  if (!pageInfo.isGroupPage) {
    isCapturing = false;
    ensureFeedObserver().interrupt();

    notifyBackground({
      type: 'CAPTURE_INTERRUPTED',
      tabId: 0,
    });
  }
}

export function initializeCaptureController(): void {
  window.addEventListener('pagehide', () => {
    if (!isCapturing) {
      return;
    }

    isCapturing = false;
    ensureFeedObserver().interrupt();

    notifyBackground({
      type: 'CAPTURE_INTERRUPTED',
      tabId: 0,
    });
  });

  window.addEventListener('popstate', handleNavigationChange);

  const originalPushState = history.pushState.bind(history);
  history.pushState = (...args: Parameters<History['pushState']>) => {
    originalPushState(...args);
    handleNavigationChange();
  };

  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = (...args: Parameters<History['replaceState']>) => {
    originalReplaceState(...args);
    handleNavigationChange();
  };
}

export function handleContentMessage(
  request: unknown,
  _sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const parsedRequest: ContentRequest = parseContentRequest(request);

  switch (parsedRequest.type) {
    case 'GET_PAGE_INFO': {
      const pageInfo = getGroupPageInfo();
      return Promise.resolve({
        type: 'PAGE_INFO',
        isGroupPage: pageInfo.isGroupPage,
        groupName: pageInfo.groupName,
        groupUrl: pageInfo.groupUrl,
      });
    }
    case 'BEGIN_CAPTURE':
      beginCapture(parsedRequest.mode);
      return Promise.resolve({
        type: 'CAPTURE_STATE',
        isCapturing: true,
      });
    case 'END_CAPTURE':
      endCapture();
      return Promise.resolve({
        type: 'CAPTURE_STATE',
        isCapturing: false,
      });
    default:
      return Promise.resolve({
        type: 'ERROR',
        message: 'Unhandled content message',
      });
  }
}
