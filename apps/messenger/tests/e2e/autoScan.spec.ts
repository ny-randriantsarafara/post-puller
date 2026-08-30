import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { parseBackgroundResponse } from '../../src/shared/messaging/protocol';
import type { CaptureSession } from '../../src/shared/types/session';

const extensionPath = join(import.meta.dirname, '..', '..', 'dist');
const fixturePath = join(import.meta.dirname, '..', 'fixtures', 'thread-page.html');
const THREAD_ID = '61550999888777';
const threadUrl = `https://www.messenger.com/t/${THREAD_ID}`;

// Two already on screen, four prepended as the panel is scrolled to its top.
const TOTAL_MESSAGES = 6;

let context: BrowserContext;
let threadPage: Page;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  threadPage = await context.newPage();

  await threadPage.route('https://www.messenger.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: readFileSync(fixturePath, 'utf8'),
    });
  });

  await threadPage.goto(threadUrl, { waitUntil: 'domcontentloaded' });
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

async function getThreadTabId(): Promise<number> {
  const serviceWorker = context.serviceWorkers()[0];
  if (serviceWorker === undefined) {
    throw new Error('Service worker is not available');
  }

  const tabId = await serviceWorker.evaluate(async (threadId: string) => {
    const tabs = await chrome.tabs.query({ url: '*://*.messenger.com/*' });
    return tabs.find((tab) => tab.url?.includes(threadId))?.id ?? null;
  }, THREAD_ID);

  if (tabId === null) {
    throw new Error('The conversation tab was not found');
  }

  return tabId;
}

// Reading the session opens an extension page, which hides the conversation tab
// and pauses scrolling, so the conversation is brought back to the front after.
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
  await threadPage.bringToFront();

  const response = parseBackgroundResponse(rawResponse);
  if (response.type === 'ERROR') {
    throw new Error(response.message);
  }

  return response.session;
}

function countRenderedMessages(): Promise<number> {
  return threadPage.evaluate(
    () => document.querySelectorAll('[aria-roledescription="message"]').length,
  );
}

async function readStoredMessageCount(): Promise<number> {
  const session = await readSession({ type: 'GET_SESSION' });

  return session.collectionStats
    .filter((stats) => stats.collection.url.includes(THREAD_ID))
    .reduce((total, stats) => total + stats.itemCount, 0);
}

async function runScanToCompletion(): Promise<void> {
  const tabId = await getThreadTabId();

  const startedSession = await readSession({
    type: 'START_CAPTURE',
    tabId,
    mode: 'auto',
    options: { captureReactions: true, captureAttachments: true },
  });
  expect(startedSession.mode).toBe('auto');

  // Nothing in this test scrolls the conversation: only the extension does, and
  // the scroller reports itself finished only once the panel is at its top,
  // which the fixture reaches only after prepending every older group.
  await expect
    .poll(
      async () => {
        const session = await readSession({ type: 'GET_SESSION' });
        return session.autoScrollCompletedAt !== null;
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBe(true);

  await expect.poll(readStoredMessageCount, { timeout: 20_000 }).toBe(TOTAL_MESSAGES);

  // The scan's own account of itself, which the popup shows and which is the
  // only signal a scan that reads nothing produces. Every stored message was
  // seen at least once, so a scan that stored the conversation cannot report
  // having seen less of it.
  const session = await readSession({ type: 'GET_SESSION' });
  expect(session.scanStats.seenItemCount).toBeGreaterThanOrEqual(TOTAL_MESSAGES);
  expect(session.scanStats.unreadItemCount).toBeLessThan(
    session.scanStats.seenItemCount,
  );

  await readSession({ type: 'STOP_CAPTURE' });
}

async function openPreview(): Promise<Page> {
  const extensionId = await getExtensionId();
  const previewPage = await context.newPage();
  await previewPage.goto(`chrome-extension://${extensionId}/src/preview/index.html`);
  await previewPage.waitForSelector('.message');

  return previewPage;
}

test('scrolls a conversation back to its start and stores every message once', async () => {
  test.setTimeout(150_000);

  await runScanToCompletion();

  // The conversation was stored in full while holding only a fraction of itself
  // in the DOM, which is what says capture read mutations rather than sweeping
  // the page once the scrolling was over.
  expect(await countRenderedMessages()).toBeLessThan(TOTAL_MESSAGES);

  const previewPage = await openPreview();

  await expect(previewPage.locator('.message')).toHaveCount(TOTAL_MESSAGES);

  // The scan reached the top of the panel, so the export may call itself
  // complete. Reporting this wrongly is what would mark a partial history whole.
  await expect(previewPage.locator('.preview__summary')).toContainText(
    'read back to the first message',
  );

  // Every message took its day from the separator above it, across both
  // separator shapes the fixture renders.
  await expect(previewPage.locator('.preview__summary')).not.toContainText(
    'without a resolved date',
  );
  await expect(previewPage.locator('.message__date', { hasText: 'No date' })).toHaveCount(
    0,
  );

  // Searching a conversation walks its date-ordered index applying the test to
  // each message, so it is only right end to end: the text has to be stored, and
  // the walk has to page from a key the index holds.
  const messages = previewPage.locator('.message');
  await previewPage.getByLabel('Search').fill('reply');
  await expect(messages).toHaveCount(1);
  await expect(messages.first()).toContainText('the reply already on screen');

  await previewPage.getByRole('button', { name: 'Clear filters' }).click();
  await expect(messages).toHaveCount(TOTAL_MESSAGES);

  await previewPage.close();
});

// The idempotence requirement, end to end: a second scan of a conversation
// already captured must store nothing new.
test('stores nothing new when the same conversation is scanned again', async () => {
  test.setTimeout(150_000);

  await threadPage.reload({ waitUntil: 'domcontentloaded' });
  await runScanToCompletion();

  const previewPage = await openPreview();
  await expect(previewPage.locator('.message')).toHaveCount(TOTAL_MESSAGES);
  await previewPage.close();
});
