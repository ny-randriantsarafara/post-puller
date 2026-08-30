import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { z } from 'zod';
import {
  parseBackgroundResponse,
  type BackgroundResponse,
} from '../../src/shared/messaging/protocol';
import { sumCollectionStats } from '../../src/shared/stats/collectionStats';

// Only what this test reads back out of an exported file, parsed rather than
// asserted so a file whose shape changed fails here instead of being read as if
// it had not.
const exportedFileSchema = z.object({
  collection: z.object({ name: z.string().nullable(), url: z.string() }),
  stats: z.object({ postCount: z.number() }),
  posts: z.array(z.object({ text: z.string().nullable() })),
});

const extensionPath = join(import.meta.dirname, '..', '..', 'dist');
const fixturePath = join(import.meta.dirname, '..', 'fixtures', 'group-page.html');
const collectionUrl = 'https://www.facebook.com/groups/sample-group';

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

  await facebookPage.goto(collectionUrl, { waitUntil: 'domcontentloaded' });
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

  return sumCollectionStats(response.session.collectionStats).itemCount;
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

  // Searching is a walk of the publication-order index with a test applied to
  // each post, so it is only right end to end: the store has to hold the text of
  // a post the index reached, under a key the walk can page from.
  const postCards = preview.locator('article.post-card');
  await expect(postCards).toHaveCount(3);

  const searchBox = preview.getByLabel('Search');
  await searchBox.fill('manual scroll');
  await expect(postCards).toHaveCount(1);
  await expect(postCards.first()).toContainText('Post loaded after manual scroll');

  await preview.getByRole('button', { name: 'Clear filters' }).click();
  await expect(postCards).toHaveCount(3);

  // The file is written a page at a time into a blob rather than serialised as one
  // string, so it is downloaded and parsed here: a header that no longer joins up
  // with the posts appended after it would still look right in any unit test of
  // its pieces.
  const [download] = await Promise.all([
    preview.waitForEvent('download'),
    preview.getByRole('button', { name: 'Export JSON' }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/^sample-group_.*\.json$/);

  const downloadPath = await download.path();
  const exportedFile = exportedFileSchema.parse(
    JSON.parse(readFileSync(downloadPath, 'utf8')),
  );

  expect(exportedFile.collection).toEqual({
    name: 'Sample Group',
    url: collectionUrl,
  });
  expect(exportedFile.stats.postCount).toBe(3);
  // Oldest published first, which is not the order the posts were captured in:
  // the scroll post was stored last and was published most recently, and the
  // second post was stored first and published earliest. An export that came out
  // in capture order would put them the other way round.
  expect(exportedFile.posts.map((post) => post.text)).toEqual([
    'Second captured post',
    'First captured post with expanded text',
    'Post loaded after manual scroll',
  ]);
});
