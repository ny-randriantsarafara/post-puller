import {
  clearGroupPosts,
  clearPosts,
  listGroupStats,
  listIdentityKeys,
  upsertPosts,
} from '../shared/storage/postRepository';
import type { CaptureMode, CaptureSession } from '../shared/types';
import { EMPTY_CAPTURE_SESSION } from '../shared/types';
import {
  parseBackgroundRequest,
  parseContentResponse,
  type BackgroundRequest,
  type BackgroundResponse,
  type ContentResponse,
} from '../shared/messaging/protocol';
import { trySendTabRequest } from '../shared/messaging/client';
import { toErrorMessage } from '../shared/errorMessage';
import { err, ok, type Result } from '../shared/result';
import { readCaptureSession, writeCaptureSession } from './sessionStore';

const CONTENT_SCRIPT_UNREACHABLE_MESSAGE =
  'Could not reach the Facebook tab. Refresh it, then start capture again.';

let identityKeys = new Set<string>();
let identityKeysLoaded = false;

async function ensureIdentityKeysLoaded(): Promise<void> {
  if (identityKeysLoaded) {
    return;
  }

  const keys = await listIdentityKeys();
  identityKeys = new Set(keys);
  identityKeysLoaded = true;
}

async function refreshSessionCounts(session: CaptureSession): Promise<CaptureSession> {
  const groupStats = await listGroupStats();

  return {
    ...session,
    groupStats,
  };
}

type PageInfo = {
  isGroupPage: boolean;
  groupName: string | null;
  groupUrl: string | null;
};

function readContentScriptFiles(): string[] {
  const contentScripts = chrome.runtime.getManifest().content_scripts ?? [];
  return contentScripts.flatMap((contentScript) => contentScript.js ?? []);
}

// A tab opened before the extension was installed or reloaded has no content
// script, so messaging it fails. Injecting the declared files makes capture work
// without asking the user to refresh the tab first.
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

// Injection only runs after a failed message, because injecting into a tab that
// already runs the content script would start a second capture loop in it.
async function requestPageInfo(tabId: number): Promise<Result<PageInfo, string>> {
  const firstAttempt = await trySendTabRequest(
    tabId,
    { type: 'GET_PAGE_INFO' },
    parseContentResponse,
  );

  if (firstAttempt.ok) {
    return toPageInfo(firstAttempt.value);
  }

  const injection = await injectContentScript(tabId);
  if (!injection.ok) {
    return err(CONTENT_SCRIPT_UNREACHABLE_MESSAGE);
  }

  const secondAttempt = await trySendTabRequest(
    tabId,
    { type: 'GET_PAGE_INFO' },
    parseContentResponse,
  );

  if (!secondAttempt.ok) {
    return err(CONTENT_SCRIPT_UNREACHABLE_MESSAGE);
  }

  return toPageInfo(secondAttempt.value);
}

function toPageInfo(response: ContentResponse): Result<PageInfo, string> {
  if (response.type !== 'PAGE_INFO') {
    return err('Unable to read page info from the Facebook tab.');
  }

  return ok({
    isGroupPage: response.isGroupPage,
    groupName: response.groupName,
    groupUrl: response.groupUrl,
  });
}

async function sendBeginCapture(
  tabId: number,
  mode: CaptureMode,
): Promise<Result<void, string>> {
  const response = await trySendTabRequest(
    tabId,
    { type: 'BEGIN_CAPTURE', mode },
    parseContentResponse,
  );

  if (!response.ok) {
    return err(CONTENT_SCRIPT_UNREACHABLE_MESSAGE);
  }

  return ok(undefined);
}

// Stopping must succeed even when the tab is already closed or navigated away,
// otherwise the session would stay stuck in the capturing state.
async function sendEndCapture(tabId: number): Promise<void> {
  await trySendTabRequest(tabId, { type: 'END_CAPTURE' }, parseContentResponse);
}

async function handleStartCapture(
  tabId: number,
  mode: CaptureMode,
): Promise<BackgroundResponse> {
  await ensureIdentityKeysLoaded();

  const pageInfo = await requestPageInfo(tabId);
  if (!pageInfo.ok) {
    return {
      type: 'ERROR',
      message: pageInfo.error,
    };
  }

  if (!pageInfo.value.isGroupPage || pageInfo.value.groupUrl === null) {
    return {
      type: 'ERROR',
      message: 'Open a Facebook group page before starting capture.',
    };
  }

  const startedAt = new Date().toISOString();
  const session = await refreshSessionCounts({
    ...EMPTY_CAPTURE_SESSION,
    status: 'capturing',
    mode,
    tabId,
    groupUrl: pageInfo.value.groupUrl,
    groupName: pageInfo.value.groupName,
    startedAt,
    stoppedAt: null,
    interruptedAt: null,
  });

  await writeCaptureSession(session);

  const beginCapture = await sendBeginCapture(tabId, mode);
  if (!beginCapture.ok) {
    await writeCaptureSession(await refreshSessionCounts(EMPTY_CAPTURE_SESSION));
    return {
      type: 'ERROR',
      message: beginCapture.error,
    };
  }

  return {
    type: 'SUCCESS',
    session,
  };
}

async function handleStopCapture(): Promise<BackgroundResponse> {
  const currentSession = await readCaptureSession();

  if (currentSession.tabId !== null) {
    await sendEndCapture(currentSession.tabId);
  }

  const session = await refreshSessionCounts({
    ...currentSession,
    status: 'idle',
    stoppedAt: new Date().toISOString(),
    tabId: null,
  });

  await writeCaptureSession(session);

  return {
    type: 'SUCCESS',
    session,
  };
}

async function handlePostsCaptured(
  tabId: number,
  requestTabId: number,
  posts: import('../shared/types').CapturedPost[],
): Promise<BackgroundResponse> {
  await ensureIdentityKeysLoaded();

  const session = await readCaptureSession();
  if (session.status !== 'capturing') {
    return {
      type: 'SESSION',
      session,
    };
  }

  const activeTabId = tabId > 0 ? tabId : requestTabId;
  if (session.tabId !== null && session.tabId !== activeTabId) {
    return {
      type: 'SESSION',
      session,
    };
  }

  await upsertPosts(posts);
  for (const post of posts) {
    identityKeys.add(post.identityKey);
  }

  const refreshedSession = await refreshSessionCounts(session);
  await writeCaptureSession(refreshedSession);

  return {
    type: 'SUCCESS',
    session: refreshedSession,
  };
}

// Auto-scroll reaching the end of the feed is progress worth reporting, not a
// reason to end the session: the user decides when to stop.
async function handleAutoScrollCompleted(tabId: number): Promise<CaptureSession> {
  const session = await readCaptureSession();
  if (session.status !== 'capturing' || session.tabId !== tabId) {
    return session;
  }

  const completedSession = await refreshSessionCounts({
    ...session,
    autoScrollCompletedAt: new Date().toISOString(),
  });

  await writeCaptureSession(completedSession);

  return completedSession;
}

async function handleCaptureInterrupted(tabId: number): Promise<void> {
  const session = await readCaptureSession();
  if (session.tabId !== null && session.tabId !== tabId && tabId > 0) {
    return;
  }

  const interruptedSession = await refreshSessionCounts({
    ...session,
    status: 'interrupted',
    interruptedAt: new Date().toISOString(),
    tabId: null,
  });

  await writeCaptureSession(interruptedSession);
}

async function handleClearData(): Promise<BackgroundResponse> {
  await clearPosts();
  identityKeys = new Set();
  identityKeysLoaded = true;

  const session = await refreshSessionCounts({
    ...EMPTY_CAPTURE_SESSION,
  });

  await writeCaptureSession(session);

  return {
    type: 'SUCCESS',
    session,
  };
}

async function handleClearGroupData(groupUrl: string): Promise<BackgroundResponse> {
  await clearGroupPosts(groupUrl);
  await ensureIdentityKeysLoaded();
  identityKeys = new Set(await listIdentityKeys());
  identityKeysLoaded = true;

  const currentSession = await readCaptureSession();
  const session = await refreshSessionCounts(currentSession);

  await writeCaptureSession(session);

  return {
    type: 'SUCCESS',
    session,
  };
}

export async function handleBackgroundMessage(
  request: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  const parsedRequest: BackgroundRequest = parseBackgroundRequest(request);

  switch (parsedRequest.type) {
    case 'GET_SESSION': {
      const session = await refreshSessionCounts(await readCaptureSession());
      await writeCaptureSession(session);
      return {
        type: 'SESSION',
        session,
      };
    }
    case 'START_CAPTURE':
      return handleStartCapture(parsedRequest.tabId, parsedRequest.mode);
    case 'STOP_CAPTURE':
      return handleStopCapture();
    case 'CLEAR_DATA':
      return handleClearData();
    case 'CLEAR_GROUP_DATA':
      return handleClearGroupData(parsedRequest.groupUrl);
    case 'POSTS_CAPTURED': {
      const senderTabId = sender.tab?.id ?? -1;
      return handlePostsCaptured(senderTabId, parsedRequest.tabId, parsedRequest.posts);
    }
    case 'CAPTURE_INTERRUPTED': {
      const senderTabId = sender.tab?.id ?? parsedRequest.tabId;
      await handleCaptureInterrupted(senderTabId);
      const session = await readCaptureSession();
      return {
        type: 'SESSION',
        session,
      };
    }
    case 'AUTO_SCROLL_COMPLETED': {
      const senderTabId = sender.tab?.id ?? parsedRequest.tabId;
      return {
        type: 'SESSION',
        session: await handleAutoScrollCompleted(senderTabId),
      };
    }
    default:
      return {
        type: 'ERROR',
        message: 'Unhandled background message',
      };
  }
}

// Lifecycle listeners have no caller to return an error to, so failures are
// reported instead of surfacing as unhandled rejections in the service worker.
function runLifecycleTask(task: () => Promise<void>): void {
  void task().catch((error: unknown) => {
    console.error('Capture lifecycle task failed:', toErrorMessage(error));
  });
}

export function registerLifecycleHandlers(): void {
  chrome.tabs.onRemoved.addListener((tabId) => {
    runLifecycleTask(async () => {
      const session = await readCaptureSession();
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
      const session = await readCaptureSession();
      if (session.tabId !== details.tabId || session.status !== 'capturing') {
        return;
      }

      const isStillGroupPage = /^https:\/\/(www\.)?facebook\.com\/groups\/[^/?#]+/.test(
        details.url,
      );

      if (isStillGroupPage) {
        return;
      }

      await sendEndCapture(session.tabId);

      await handleCaptureInterrupted(details.tabId);
    });
  });
}
