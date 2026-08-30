import { join } from 'node:path';
import { chromium, type BrowserContext } from '@playwright/test';

const extensionPath = join(import.meta.dirname, '..', '..', 'dist');

// The built extension, loaded the only way Chrome will load an unpacked one: a
// persistent context, launched with the extension whitelisted.
//
// The channel is what makes this headless. Playwright's default headless browser
// is the headless shell, which has no extension support at all, so the tests had
// to run with a visible window; asking for the chromium channel gets the full
// browser, whose own headless mode does load extensions.
export function launchExtensionContext(): Promise<BrowserContext> {
  return chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
}
