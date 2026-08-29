import type { CaptureDomain } from '../domain/captureDomain';
import type { CapturedItemBase } from '../domain/item';
import { toErrorMessage } from '../errorMessage';
import { trySendTabRequest } from '../messaging/client';
import type {
  BackgroundRequest,
  BackgroundResponse,
  CaptureProtocol,
  ContentResponse,
} from '../messaging/protocol';
import type { CaptureMode, CaptureSession } from '../messaging/session';
import { err, ok, type Result } from '../result';
import type { ItemRepository } from '../storage/itemRepository';
import type { SessionStore } from './sessionStore';

// Every sentence the coordinator can hand back to the popup. They name the site
// the user is looking at, so they belong to the app rather than here.
export type CoordinatorCopy = {
  readonly contentScriptUnreachable: string;
  readonly pageInfoUnreadable: string;
  readonly notOnTargetPage: string;
};

export type PageInfo = {
  isTargetPage: boolean;
  collectionName: string | null;
  collectionUrl: string | null;
};

export type CaptureCoordinator<TOptions extends object> = {
  handleBackgroundMessage: (
    request: unknown,
    sender: chrome.runtime.MessageSender,
  ) => Promise<BackgroundResponse<TOptions>>;
  registerLifecycleHandlers: () => void;
};

export type CaptureCoordinatorConfig<
  TItem extends CapturedItemBase,
  TOptions extends object,
> = {
  readonly domain: CaptureDomain<TItem, TOptions>;
  readonly protocol: CaptureProtocol<TItem, TOptions>;
  readonly repository: ItemRepository<TItem>;
  readonly sessionStore: SessionStore<TOptions>;
  readonly copy: CoordinatorCopy;
};

export function createCaptureCoordinator<
  TItem extends CapturedItemBase,
  TOptions extends object,
>({
  domain,
  protocol,
  repository,
  sessionStore,
  copy,
}: CaptureCoordinatorConfig<TItem, TOptions>): CaptureCoordinator<TOptions> {
  async function refreshSessionCounts(
    session: CaptureSession<TOptions>,
  ): Promise<CaptureSession<TOptions>> {
    const collectionStats = await repository.listCollectionStats();

    return {
      ...session,
      collectionStats,
    };
  }

  function readContentScriptFiles(): string[] {
    const contentScripts = chrome.runtime.getManifest().content_scripts ?? [];
    return contentScripts.flatMap((contentScript) => contentScript.js ?? []);
  }

  // A tab opened before the extension was installed or reloaded has no content
  // script, so messaging it fails. Injecting the declared files makes capture
  // work without asking the user to refresh the tab first.
  async function injectContentScript(tabId: number): Promise<Result<void, string>> {
    const files = readContentScriptFiles();
    if (files.length === 0) {
      return err('No content script is declared in the manifest.');
    }

    try {
      await chrome.scripting.executeScript({ target: { tabId }, files });
      return ok(undefined);
    } catch (error) {
      return err(toErrorMessage(error));
    }
  }

  function toPageInfo(response: ContentResponse): Result<PageInfo, string> {
    if (response.type !== 'PAGE_INFO') {
      return err(copy.pageInfoUnreadable);
    }

    return ok({
      isTargetPage: response.isTargetPage,
      collectionName: response.collectionName,
      collectionUrl: response.collectionUrl,
    });
  }

  // Injection only runs after a failed message, because injecting into a tab
  // that already runs the content script would start a second capture loop.
  async function requestPageInfo(tabId: number): Promise<Result<PageInfo, string>> {
    const firstAttempt = await trySendTabRequest(
      tabId,
      { type: 'GET_PAGE_INFO' },
      protocol.parseContentResponse,
    );

    if (firstAttempt.ok) {
      return toPageInfo(firstAttempt.value);
    }

    const injection = await injectContentScript(tabId);
    if (!injection.ok) {
      return err(copy.contentScriptUnreachable);
    }

    const secondAttempt = await trySendTabRequest(
      tabId,
      { type: 'GET_PAGE_INFO' },
      protocol.parseContentResponse,
    );

    if (!secondAttempt.ok) {
      return err(copy.contentScriptUnreachable);
    }

    return toPageInfo(secondAttempt.value);
  }

  async function sendBeginCapture(
    tabId: number,
    mode: CaptureMode,
    options: TOptions,
  ): Promise<Result<void, string>> {
    const response = await trySendTabRequest(
      tabId,
      { type: 'BEGIN_CAPTURE', mode, options },
      protocol.parseContentResponse,
    );

    if (!response.ok) {
      return err(copy.contentScriptUnreachable);
    }

    return ok(undefined);
  }

  // Stopping must succeed even when the tab is already closed or navigated
  // away, otherwise the session would stay stuck in the capturing state.
  async function sendEndCapture(tabId: number): Promise<void> {
    await trySendTabRequest(
      tabId,
      { type: 'END_CAPTURE' },
      protocol.parseContentResponse,
    );
  }

  async function handleStartCapture(
    tabId: number,
    mode: CaptureMode,
    options: TOptions,
  ): Promise<BackgroundResponse<TOptions>> {
    const pageInfo = await requestPageInfo(tabId);
    if (!pageInfo.ok) {
      return { type: 'ERROR', message: pageInfo.error };
    }

    if (!pageInfo.value.isTargetPage || pageInfo.value.collectionUrl === null) {
      return { type: 'ERROR', message: copy.notOnTargetPage };
    }

    const session = await refreshSessionCounts({
      ...sessionStore.emptySession,
      status: 'capturing',
      mode,
      options,
      tabId,
      collectionUrl: pageInfo.value.collectionUrl,
      collectionName: pageInfo.value.collectionName,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      interruptedAt: null,
    });

    await sessionStore.write(session);

    const beginCapture = await sendBeginCapture(tabId, mode, options);
    if (!beginCapture.ok) {
      await sessionStore.write(await refreshSessionCounts(sessionStore.emptySession));
      return { type: 'ERROR', message: beginCapture.error };
    }

    return { type: 'SUCCESS', session };
  }

  async function handleStopCapture(): Promise<BackgroundResponse<TOptions>> {
    const currentSession = await sessionStore.read();

    if (currentSession.tabId !== null) {
      await sendEndCapture(currentSession.tabId);
    }

    const session = await refreshSessionCounts({
      ...currentSession,
      status: 'idle',
      stoppedAt: new Date().toISOString(),
      tabId: null,
    });

    await sessionStore.write(session);

    return { type: 'SUCCESS', session };
  }

  async function handleItemsCaptured(
    tabId: number,
    requestTabId: number,
    items: TItem[],
  ): Promise<BackgroundResponse<TOptions>> {
    const session = await sessionStore.read();
    if (session.status !== 'capturing') {
      return { type: 'SESSION', session };
    }

    const activeTabId = tabId > 0 ? tabId : requestTabId;
    if (session.tabId !== null && session.tabId !== activeTabId) {
      return { type: 'SESSION', session };
    }

    await repository.upsertItems(items);

    const refreshedSession = await refreshSessionCounts(session);
    await sessionStore.write(refreshedSession);

    return { type: 'SUCCESS', session: refreshedSession };
  }

  // Auto-scroll reaching the end of the page is progress worth reporting, not a
  // reason to end the session: the user decides when to stop.
  async function handleAutoScrollCompleted(
    tabId: number,
  ): Promise<CaptureSession<TOptions>> {
    const session = await sessionStore.read();
    if (session.status !== 'capturing' || session.tabId !== tabId) {
      return session;
    }

    const completedSession = await refreshSessionCounts({
      ...session,
      autoScrollCompletedAt: new Date().toISOString(),
    });

    await sessionStore.write(completedSession);

    return completedSession;
  }

  async function handleCaptureInterrupted(tabId: number): Promise<void> {
    const session = await sessionStore.read();
    if (session.tabId !== null && session.tabId !== tabId && tabId > 0) {
      return;
    }

    const interruptedSession = await refreshSessionCounts({
      ...session,
      status: 'interrupted',
      interruptedAt: new Date().toISOString(),
      tabId: null,
    });

    await sessionStore.write(interruptedSession);
  }

  async function handleClearData(): Promise<BackgroundResponse<TOptions>> {
    await repository.clearItems();

    const session = await refreshSessionCounts({ ...sessionStore.emptySession });
    await sessionStore.write(session);

    return { type: 'SUCCESS', session };
  }

  async function handleClearCollectionData(
    collectionUrl: string,
  ): Promise<BackgroundResponse<TOptions>> {
    await repository.clearCollectionItems(collectionUrl);

    const currentSession = await sessionStore.read();
    const session = await refreshSessionCounts(currentSession);

    await sessionStore.write(session);

    return { type: 'SUCCESS', session };
  }

  async function handleBackgroundMessage(
    request: unknown,
    sender: chrome.runtime.MessageSender,
  ): Promise<BackgroundResponse<TOptions>> {
    const parsedRequest: BackgroundRequest<TItem, TOptions> =
      protocol.parseBackgroundRequest(request);

    switch (parsedRequest.type) {
      case 'GET_SESSION': {
        const session = await refreshSessionCounts(await sessionStore.read());
        await sessionStore.write(session);
        return { type: 'SESSION', session };
      }
      case 'START_CAPTURE':
        return handleStartCapture(
          parsedRequest.tabId,
          parsedRequest.mode,
          parsedRequest.options,
        );
      case 'STOP_CAPTURE':
        return handleStopCapture();
      case 'CLEAR_DATA':
        return handleClearData();
      case 'CLEAR_COLLECTION_DATA':
        return handleClearCollectionData(parsedRequest.collectionUrl);
      case 'ITEMS_CAPTURED': {
        const senderTabId = sender.tab?.id ?? -1;
        return handleItemsCaptured(
          senderTabId,
          parsedRequest.tabId,
          parsedRequest.items,
        );
      }
      case 'CAPTURE_INTERRUPTED': {
        const senderTabId = sender.tab?.id ?? parsedRequest.tabId;
        await handleCaptureInterrupted(senderTabId);
        return { type: 'SESSION', session: await sessionStore.read() };
      }
      case 'AUTO_SCROLL_COMPLETED': {
        const senderTabId = sender.tab?.id ?? parsedRequest.tabId;
        return {
          type: 'SESSION',
          session: await handleAutoScrollCompleted(senderTabId),
        };
      }
      default: {
        const unhandled: never = parsedRequest;
        return {
          type: 'ERROR',
          message: `Unhandled background message: ${String(unhandled)}`,
        };
      }
    }
  }

  // Lifecycle listeners have no caller to return an error to, so failures are
  // reported instead of surfacing as unhandled rejections in the service worker.
  function runLifecycleTask(task: () => Promise<void>): void {
    void task().catch((error: unknown) => {
      console.error('Capture lifecycle task failed:', toErrorMessage(error));
    });
  }

  function registerLifecycleHandlers(): void {
    chrome.tabs.onRemoved.addListener((tabId) => {
      runLifecycleTask(async () => {
        const session = await sessionStore.read();
        if (session.tabId !== tabId || session.status !== 'capturing') {
          return;
        }

        await handleCaptureInterrupted(tabId);
      });
    });

    chrome.webNavigation.onCommitted.addListener((details) => {
      if (details.frameId !== 0) {
        return;
      }

      runLifecycleTask(async () => {
        const session = await sessionStore.read();
        if (session.tabId !== details.tabId || session.status !== 'capturing') {
          return;
        }

        if (domain.isTargetUrl(details.url)) {
          return;
        }

        await sendEndCapture(session.tabId);
        await handleCaptureInterrupted(details.tabId);
      });
    });
  }

  return { handleBackgroundMessage, registerLifecycleHandlers };
}
