import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import {
  parseBackgroundResponse,
  type BackgroundResponse,
} from '../../src/shared/messaging/protocol';
import { sumGroupStats } from '../../src/shared/stats/groupStats';

const extensionPath = join(import.meta.dirname, '..', '..', 'dist');
const fixturePath = join(import.meta.dirname, '..', 'fixtures', 'group-page.html');
const groupUrl = 'https://www.facebook.com/groups/sample-group';

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

  const serviceWorkerUrl = serviceWorker.url();
  const extensionId = serviceWorkerUrl.split('/')[2];
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
    const facebookTab = tabs.find((tab) => tab.url?.includes('/groups/sample-group'));
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

async function getCapturedPostCount(): Promise<number> {
  const response = await sendBackgroundRequest({ type: 'GET_SESSION' });
  if (response.type === 'ERROR') {
    return 0;
  }

  return sumGroupStats(response.session.groupStats).postCount;
}

test('captures visible posts, deduplicates, persists, and exports JSON', async () => {
  const extensionId = await getExtensionId();
  const tabId = await getFacebookTabId();

  const startResponse = await sendBackgroundRequest({
    type: 'START_CAPTURE',
    tabId,
    mode: 'manual',
  });
  expect(startResponse).toMatchObject({
    type: 'SUCCESS',
    session: {
      status: 'capturing',
    },
  });

  await expect
    .poll(getCapturedPostCount, { timeout: 10_000 })
    .toBe(2);

  await facebookPage.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });

  await expect
    .poll(getCapturedPostCount, { timeout: 10_000 })
    .toBe(3);

  // The scrolled-away post is emptied by the fixture. It must stay stored under
  // its own identity instead of being replaced by an unidentifiable record.
  await expect
    .poll(getCapturedPostCount, { timeout: 3_000, intervals: [500, 500, 500] })
    .toBe(3);

  await sendBackgroundRequest({ type: 'STOP_CAPTURE' });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await expect(popup.getByText('Idle')).toBeVisible({ timeout: 10_000 });
  await expect(popup.getByText('3', { exact: true })).toBeVisible({ timeout: 10_000 });
  await popup.close();

  const popupAgain = await context.newPage();
  await popupAgain.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await expect(popupAgain.getByText('3', { exact: true })).toBeVisible({ timeout: 10_000 });
  await popupAgain.close();

  const preview = await context.newPage();
  await preview.goto(`chrome-extension://${extensionId}/src/preview/index.html`);
  await expect(preview.getByRole('heading', { name: 'Sample Group' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(preview.getByText('3 posts')).toBeVisible({ timeout: 10_000 });
  await expect(preview.getByText('First captured post with expanded text')).toBeVisible({
    timeout: 10_000,
  });
  await expect(preview.getByText('Second captured post')).toBeVisible({ timeout: 10_000 });
  await expect(preview.getByText('Post loaded after manual scroll')).toBeVisible({
    timeout: 10_000,
  });
  await expect(preview.getByText('Open post on Facebook').first()).toBeVisible({
    timeout: 10_000,
  });
  const expandedPostCard = preview.locator('article.post-card', {
    hasText: 'First captured post with expanded text',
  });
  await expect(expandedPostCard.getByText('(2 hours ago)')).toBeVisible({
    timeout: 10_000,
  });

  const expandedPostLink = expandedPostCard.locator('a.post-card__link');
  await expect(expandedPostLink).toHaveAttribute(
    'href',
    /\/groups\/sample-group\/posts\/1001\/?$/,
  );

  const exportPayload = await preview.evaluate(() => document.body.innerText);
  expect(exportPayload).toContain('Export JSON');
});
