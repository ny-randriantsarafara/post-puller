import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import {
  parseBackgroundResponse,
  type BackgroundResponse,
} from '../../src/shared/messaging/protocol';

const extensionPath = join(import.meta.dirname, '..', '..', 'dist');
const fixturePath = join(import.meta.dirname, '..', 'fixtures', 'comment-expansion-page.html');
const groupUrl = 'https://www.facebook.com/groups/comment-expansion';

let context: BrowserContext;
let facebookPage: Page;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  facebookPage = await context.newPage();

  await facebookPage.route('https://www.facebook.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: readFileSync(fixturePath, 'utf8'),
    });
  });

  await facebookPage.goto(groupUrl, { waitUntil: 'domcontentloaded' });
});

test.afterAll(async () => {
  await context.close();
});

async function getExtensionId(): Promise<string> {
  let serviceWorker = context.serviceWorkers()[0];
  if (serviceWorker === undefined) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }

  const extensionId = serviceWorker.url().split('/')[2];
  if (extensionId === undefined) {
    throw new Error('Unable to resolve extension id');
  }

  return extensionId;
}

async function getFacebookTabId(): Promise<number> {
  const serviceWorker = context.serviceWorkers()[0];
  if (serviceWorker === undefined) {
    throw new Error('Service worker is not available');
  }

  const tabId = await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
    const facebookTab = tabs.find((tab) => tab.url?.includes('/groups/comment-expansion'));
    return facebookTab?.id ?? null;
  });

  if (tabId === null) {
    throw new Error('Facebook tab was not found');
  }

  return tabId;
}

async function sendBackgroundRequest(
  request: Record<string, unknown>,
): Promise<BackgroundResponse> {
  const extensionId = await getExtensionId();
  const bridgePage = await context.newPage();
  await bridgePage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

  const response: unknown = await bridgePage.evaluate<
    unknown,
    Record<string, unknown>
  >(async (backgroundRequest) => {
    const browserResponse: unknown =
      await chrome.runtime.sendMessage(backgroundRequest);
    return browserResponse;
  }, request);

  await bridgePage.close();
  return parseBackgroundResponse(response);
}

async function readStoredCommentTexts(): Promise<string[]> {
  const serviceWorker = context.serviceWorkers()[0];
  if (serviceWorker === undefined) {
    throw new Error('Service worker is not available');
  }

  return serviceWorker.evaluate(async () => {
    const posts = await new Promise<import('../../src/shared/types').CapturedPost[]>(
      (resolve, reject) => {
        const request = indexedDB.open('facebookGroupCapture');
        request.onerror = () => {
          reject(request.error ?? new Error('Failed to open IndexedDB'));
        };
        request.onsuccess = () => {
          const transaction = request.result.transaction('capturedPosts', 'readonly');
          const store = transaction.objectStore('capturedPosts');
          const getAll = store.getAll();
          getAll.onsuccess = () => {
            resolve(getAll.result as import('../../src/shared/types').CapturedPost[]);
          };
          getAll.onerror = () => {
            reject(getAll.error ?? new Error('Failed to read posts'));
          };
        };
      },
    );

    return posts.flatMap((post) =>
      post.comments.flatMap((comment) => (comment.text === null ? [] : [comment.text])),
    );
  });
}

test('captures hidden comments only when comment expansion is enabled', async () => {
  const tabId = await getFacebookTabId();

  const withoutExpansion = await sendBackgroundRequest({
    type: 'START_CAPTURE',
    tabId,
    mode: 'manual',
    expandComments: false,
  });
  expect(withoutExpansion.type).toBe('SUCCESS');

  await expect
    .poll(readStoredCommentTexts, { timeout: 10_000 })
    .toEqual(['Visible comment']);

  await sendBackgroundRequest({ type: 'STOP_CAPTURE' });
  await sendBackgroundRequest({ type: 'CLEAR_DATA' });

  const withExpansion = await sendBackgroundRequest({
    type: 'START_CAPTURE',
    tabId,
    mode: 'manual',
    expandComments: true,
  });
  expect(withExpansion.type).toBe('SUCCESS');

  await expect
    .poll(readStoredCommentTexts, { timeout: 10_000 })
    .toEqual(['Visible comment', 'Hidden comment revealed after expansion']);

  await sendBackgroundRequest({ type: 'STOP_CAPTURE' });
});
