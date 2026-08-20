import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseContentRequest,
  type BackgroundResponse,
  type ContentResponse,
} from '../shared/messaging/protocol';
import { clearPosts, upsertPosts } from '../shared/storage/postRepository';
import { sumGroupStats } from '../shared/stats/groupStats';
import type { CapturedPost } from '../shared/types';
import { handleBackgroundMessage } from './captureCoordinator';

const CONNECTION_ERROR = 'Could not establish connection. Receiving end does not exist.';
const CONTENT_SCRIPT_FILE = 'assets/content-loader.js';
const SAMPLE_TAB_ID = 42;

function respondAsContentScript(
  _tabId: number,
  request: unknown,
): Promise<ContentResponse> {
  const parsedRequest = parseContentRequest(request);

  if (parsedRequest.type === 'GET_PAGE_INFO') {
    return Promise.resolve({
      type: 'PAGE_INFO',
      isGroupPage: true,
      groupName: 'Sample Group',
      groupUrl: 'https://www.facebook.com/groups/sample-group',
    });
  }

  return Promise.resolve({
    type: 'CAPTURE_STATE',
    isCapturing: parsedRequest.type === 'BEGIN_CAPTURE',
  });
}

function stubChrome(
  sendMessage: (tabId: number, request: unknown) => Promise<ContentResponse>,
  executeScript: (details: chrome.scripting.ScriptInjection<[], unknown>) => Promise<void>,
): void {
  const storage = new Map<string, unknown>();

  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: (key: string) =>
          Promise.resolve(storage.has(key) ? { [key]: storage.get(key) } : {}),
        set: (values: Record<string, unknown>) => {
          Object.entries(values).forEach(([key, value]) => {
            storage.set(key, value);
          });
          return Promise.resolve();
        },
      },
    },
    tabs: { sendMessage },
    scripting: { executeScript },
    runtime: {
      getManifest: () => ({
        content_scripts: [{ js: [CONTENT_SCRIPT_FILE] }],
      }),
    },
  });
}

async function readSessionStatus(): Promise<string> {
  const response = await handleBackgroundMessage({ type: 'GET_SESSION' }, {});
  if (response.type === 'ERROR') {
    throw new Error(response.message);
  }

  return response.session.status;
}

function startCapture(
  mode: 'manual' | 'auto',
  expandComments = false,
): Promise<BackgroundResponse> {
  return handleBackgroundMessage(
    { type: 'START_CAPTURE', tabId: SAMPLE_TAB_ID, mode, expandComments },
    {},
  );
}

function createStoredPost(postId: string, groupUrl: string, groupName: string): CapturedPost {
  const capturedAt = new Date().toISOString();

  return {
    identityKey: `postId:${postId}`,
    identitySource: 'postId',
    fingerprint: null,
    postId,
    postUrl: `${groupUrl}/posts/${postId}/`,
    group: {
      name: groupName,
      url: groupUrl,
    },
    author: { kind: 'named', name: 'Jane Doe', profileUrl: null },
    text: `Post ${postId}`,
    displayedDate: '1 hour ago',
    publishedAt: capturedAt,
    reactionCount: 1,
    reactionBreakdown: {},
    commentCount: null,
    shareCount: null,
    comments: [],
    attachments: [{ kind: 'none' }],
    capturedAt,
    updatedAt: capturedAt,
    warnings: [],
  };
}

describe('handleBackgroundMessage', () => {
  beforeEach(async () => {
    await clearPosts();
  });

  it('injects the content script and starts capture when the tab has no listener', async () => {
    const sendMessage = vi.fn(respondAsContentScript);
    sendMessage.mockRejectedValueOnce(new Error(CONNECTION_ERROR));
    const executeScript = vi.fn(() => Promise.resolve());
    stubChrome(sendMessage, executeScript);

    const response = await startCapture('manual');

    expect(response).toMatchObject({
      type: 'SUCCESS',
      session: { status: 'capturing' },
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: SAMPLE_TAB_ID },
      files: [CONTENT_SCRIPT_FILE],
    });
  });

  it('never injects a second content script into a tab that already answers', async () => {
    const executeScript = vi.fn(() => Promise.resolve());
    stubChrome(vi.fn(respondAsContentScript), executeScript);

    const response = await startCapture('manual');

    expect(response).toMatchObject({ type: 'SUCCESS' });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('reports a readable error and stays idle when the tab cannot be reached', async () => {
    stubChrome(
      vi.fn(() => Promise.reject(new Error(CONNECTION_ERROR))),
      vi.fn(() => Promise.reject(new Error('Cannot access contents of the page.'))),
    );

    const response = await startCapture('manual');

    expect(response).toMatchObject({
      type: 'ERROR',
      message: 'Could not reach the Facebook tab. Refresh it, then start capture again.',
    });
    await expect(readSessionStatus()).resolves.toBe('idle');
  });

  it('stops a capture session whose tab is already gone', async () => {
    const sendMessage = vi.fn(respondAsContentScript);
    stubChrome(sendMessage, vi.fn(() => Promise.resolve()));

    await startCapture('manual');
    sendMessage.mockRejectedValue(new Error(CONNECTION_ERROR));

    const response = await handleBackgroundMessage({ type: 'STOP_CAPTURE' }, {});

    expect(response).toMatchObject({
      type: 'SUCCESS',
      session: { status: 'idle' },
    });
  });

  it('tells the content script which scan mode to run', async () => {
    const sendMessage = vi.fn(respondAsContentScript);
    stubChrome(sendMessage, vi.fn(() => Promise.resolve()));

    const response = await startCapture('auto');

    expect(response).toMatchObject({ session: { mode: 'auto' } });
    expect(sendMessage).toHaveBeenCalledWith(SAMPLE_TAB_ID, {
      type: 'BEGIN_CAPTURE',
      mode: 'auto',
      expandComments: false,
    });
  });

  // Reaching the end of the feed is progress to report, not a reason to end the
  // session, so that later loads are still captured.
  it('keeps capturing after auto-scroll reports an exhausted feed', async () => {
    stubChrome(vi.fn(respondAsContentScript), vi.fn(() => Promise.resolve()));
    await startCapture('auto');

    const response = await handleBackgroundMessage(
      { type: 'AUTO_SCROLL_COMPLETED', tabId: SAMPLE_TAB_ID },
      {},
    );

    if (response.type === 'ERROR') {
      throw new Error(response.message);
    }

    expect(response.session.status).toBe('capturing');
    expect(response.session.autoScrollCompletedAt).not.toBeNull();
  });

  it('ignores an auto-scroll report from another tab', async () => {
    stubChrome(vi.fn(respondAsContentScript), vi.fn(() => Promise.resolve()));
    await startCapture('auto');

    const response = await handleBackgroundMessage(
      { type: 'AUTO_SCROLL_COMPLETED', tabId: SAMPLE_TAB_ID + 1 },
      {},
    );

    if (response.type === 'ERROR') {
      throw new Error(response.message);
    }

    expect(response.session.autoScrollCompletedAt).toBeNull();
  });

  it('reports per-group stats in the session', async () => {
    stubChrome(vi.fn(respondAsContentScript), vi.fn(() => Promise.resolve()));

    await upsertPosts([
      createStoredPost('1', 'https://www.facebook.com/groups/sample-group', 'Sample Group'),
      createStoredPost('2', 'https://www.facebook.com/groups/other-group', 'Other Group'),
    ]);

    const response = await handleBackgroundMessage({ type: 'GET_SESSION' }, {});
    if (response.type === 'ERROR') {
      throw new Error(response.message);
    }

    expect(response.session.groupStats).toHaveLength(2);
    expect(sumGroupStats(response.session.groupStats).postCount).toBe(2);
  });

  it('clears one group without removing the others', async () => {
    stubChrome(vi.fn(respondAsContentScript), vi.fn(() => Promise.resolve()));

    await upsertPosts([
      createStoredPost('1', 'https://www.facebook.com/groups/sample-group', 'Sample Group'),
      createStoredPost('2', 'https://www.facebook.com/groups/other-group', 'Other Group'),
    ]);

    const response = await handleBackgroundMessage(
      {
        type: 'CLEAR_GROUP_DATA',
        groupUrl: 'https://www.facebook.com/groups/sample-group',
      },
      {},
    );

    if (response.type === 'ERROR') {
      throw new Error(response.message);
    }

    expect(response.session.groupStats).toHaveLength(1);
    expect(response.session.groupStats[0]?.group.name).toBe('Other Group');
  });
});
