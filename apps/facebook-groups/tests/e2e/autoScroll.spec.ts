import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { parseBackgroundResponse } from '../../src/shared/messaging/protocol';
import { sumGroupStats } from '../../src/shared/stats/groupStats';
import type { CaptureSession } from '../../src/shared/types';

const extensionPath = join(import.meta.dirname, '..', '..', 'dist');
const fixturePath = join(import.meta.dirname, '..', 'fixtures', 'growing-group-page.html');
const groupUrl = 'https://www.facebook.com/groups/auto-group';
const TOTAL_STORIES = 6;

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
    return tabs.find((tab) => tab.url?.includes('/groups/auto-group'))?.id ?? null;
  });

  if (tabId === null) {
    throw new Error('Facebook tab was not found');
  }

  return tabId;
}

// Reading the session opens an extension page, which hides the group tab and
// pauses auto-scroll, so the group tab is brought back to the front afterwards.
async function readSession(request: Record<string, unknown>): Promise<CaptureSession> {
  const extensionId = await getExtensionId();
  const bridgePage = await context.newPage();
  await bridgePage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

  const rawResponse: unknown = await bridgePage.evaluate<
    unknown,
    Record<string, unknown>
  >(async (backgroundRequest) => {
    const browserResponse: unknown =
      await chrome.runtime.sendMessage(backgroundRequest);
    return browserResponse;
  }, request);

  await bridgePage.close();
  await facebookPage.bringToFront();

  const response = parseBackgroundResponse(rawResponse);
  if (response.type === 'ERROR') {
    throw new Error(response.message);
  }

  return response.session;
}

function countRenderedStories(): Promise<number> {
  return facebookPage.evaluate(
    () => document.querySelectorAll('[data-focus="feed_story"]').length,
  );
}

test('scrolls the group by itself and stores every post exactly once', async () => {
  test.setTimeout(150_000);

  const tabId = await getFacebookTabId();

  const startedSession = await readSession({
    type: 'START_CAPTURE',
    tabId,
    mode: 'auto',
  });
  expect(startedSession.mode).toBe('auto');

  // Nothing in this test scrolls the page: only the extension does.
  await expect.poll(countRenderedStories, { timeout: 60_000 }).toBe(TOTAL_STORIES);

  await expect
    .poll(
      async () => {
        const session = await readSession({ type: 'GET_SESSION' });
        return session.autoScrollCompletedAt !== null;
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBe(true);

  const session = await readSession({ type: 'GET_SESSION' });

  // The first story lost its node and aged its timestamp mid-run, so its content
  // hash changed. It must still count as one post, not two.
  expect(sumGroupStats(session.groupStats).postCount).toBe(TOTAL_STORIES);
  expect(session.status).toBe('capturing');

  await readSession({ type: 'STOP_CAPTURE' });
});
