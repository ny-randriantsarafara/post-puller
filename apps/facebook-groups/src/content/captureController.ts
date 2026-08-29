import type { CaptureMode, CapturedPost } from '../shared/types';
import type { CaptureOptions } from '../shared/types/captureOptions';
import {
  parseContentRequest,
  type BackgroundRequest,
  type ContentRequest,
} from '../shared/messaging/protocol';
import { trySendBackgroundRequest } from '../shared/messaging/client';
import { AutoScroller } from './autoScroll';
import { FeedObserver } from './feedObserver';
import { resolvePageTarget } from './groupPage';

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
        type: 'ITEMS_CAPTURED',
        tabId: 0,
        items: posts,
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

function beginCapture(mode: CaptureMode, options: CaptureOptions): void {
  const pageInfo = resolvePageTarget();
  if (!pageInfo.isTargetPage) {
    return;
  }

  isCapturing = true;
  ensureFeedObserver().start({ options });

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

  const pageInfo = resolvePageTarget();
  if (!pageInfo.isTargetPage) {
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
      const pageInfo = resolvePageTarget();
      return Promise.resolve({
        type: 'PAGE_INFO',
        isTargetPage: pageInfo.isTargetPage,
        collectionName: pageInfo.collectionName,
        collectionUrl: pageInfo.collectionUrl,
      });
    }
    case 'BEGIN_CAPTURE':
      beginCapture(parsedRequest.mode, parsedRequest.options);
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
