import type { CapturedItemBase } from '../domain/item';
import { createMessagingClient } from '../messaging/client';
import type {
  BackgroundRequest,
  CaptureProtocol,
  ContentRequest,
  ContentResponse,
} from '../messaging/protocol';
import type { CaptureMode } from '../messaging/session';
import { AutoScroller } from './autoScroller';
import { DEFAULT_CAPTURE_TIMING, type CaptureTiming } from './captureTiming';
import { ItemObserver } from './itemObserver';
import type { SiteAdapter } from './siteAdapter';

export type CaptureController = {
  initialize: () => void;
  handleContentMessage: (
    request: unknown,
    sender: chrome.runtime.MessageSender,
  ) => Promise<ContentResponse>;
};

export type CaptureControllerConfig<
  TItem extends CapturedItemBase,
  TOptions extends object,
> = {
  readonly adapter: SiteAdapter<TItem, TOptions>;
  readonly protocol: CaptureProtocol<TItem, TOptions>;
  readonly defaultOptions: TOptions;
  readonly timing?: CaptureTiming;
};

export function createCaptureController<
  TItem extends CapturedItemBase,
  TOptions extends object,
>({
  adapter,
  protocol,
  defaultOptions,
  timing,
}: CaptureControllerConfig<TItem, TOptions>): CaptureController {
  const resolvedTiming = timing ?? DEFAULT_CAPTURE_TIMING;
  const client = createMessagingClient<BackgroundRequest<TItem, TOptions>, unknown>(
    (value) => value,
  );

  let isCapturing = false;

  // The extension can be reloaded or removed while this script still runs in the
  // page. Capture then stops instead of leaving rejected promises behind.
  function notifyBackground(request: BackgroundRequest<TItem, TOptions>): void {
    void client.trySend(request).then((result) => {
      if (result.ok) {
        return;
      }

      endCapture();
    });
  }

  const observer = new ItemObserver<TItem, TOptions>({
    adapter,
    defaultOptions,
    timing: resolvedTiming,
    callbacks: {
      onItemsCaptured: (items) => {
        notifyBackground({ type: 'ITEMS_CAPTURED', tabId: 0, items });
      },
      onInterrupted: () => {
        isCapturing = false;
        autoScroller.stop();
      },
    },
  });

  // Scrolling stops, but capture stays on so that anything the site loads
  // afterwards is still stored.
  const autoScroller = new AutoScroller({
    resolveScrollTarget: adapter.resolveScrollTarget,
    timing: resolvedTiming,
    callbacks: {
      onExhausted: () => {
        notifyBackground({ type: 'AUTO_SCROLL_COMPLETED', tabId: 0 });
      },
    },
  });

  function beginCapture(mode: CaptureMode, options: TOptions): void {
    if (!adapter.resolvePageTarget().isTargetPage) {
      return;
    }

    isCapturing = true;
    observer.start({ options });

    if (mode === 'auto') {
      autoScroller.start();
    }
  }

  function endCapture(): void {
    isCapturing = false;
    observer.stop();
    autoScroller.stop();
  }

  function interruptCapture(): void {
    isCapturing = false;
    observer.interrupt();
    notifyBackground({ type: 'CAPTURE_INTERRUPTED', tabId: 0 });
  }

  function handleNavigationChange(): void {
    if (!isCapturing) {
      return;
    }

    if (!adapter.resolvePageTarget().isTargetPage) {
      interruptCapture();
    }
  }

  function initialize(): void {
    window.addEventListener('pagehide', () => {
      if (!isCapturing) {
        return;
      }

      interruptCapture();
    });

    window.addEventListener('popstate', handleNavigationChange);

    // A single-page app moves between pages without a document load, so the
    // history methods are the only signal that the page changed.
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

  function handleContentMessage(
    request: unknown,
    _sender: chrome.runtime.MessageSender,
  ): Promise<ContentResponse> {
    const parsedRequest: ContentRequest<TOptions> =
      protocol.parseContentRequest(request);

    switch (parsedRequest.type) {
      case 'GET_PAGE_INFO': {
        const pageTarget = adapter.resolvePageTarget();
        return Promise.resolve({
          type: 'PAGE_INFO',
          isTargetPage: pageTarget.isTargetPage,
          collectionName: pageTarget.collectionName,
          collectionUrl: pageTarget.collectionUrl,
        });
      }
      case 'BEGIN_CAPTURE':
        beginCapture(parsedRequest.mode, parsedRequest.options);
        return Promise.resolve({ type: 'CAPTURE_STATE', isCapturing: true });
      case 'END_CAPTURE':
        endCapture();
        return Promise.resolve({ type: 'CAPTURE_STATE', isCapturing: false });
      default: {
        const unhandled: never = parsedRequest;
        return Promise.resolve({
          type: 'ERROR',
          message: `Unhandled content message: ${String(unhandled)}`,
        });
      }
    }
  }

  return { initialize, handleContentMessage };
}
