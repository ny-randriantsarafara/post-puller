import { defineManifest } from '@crxjs/vite-plugin';
import packageJson from './package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'Messenger Conversation Capture',
  version: packageJson.version,
  description:
    'Scroll a Messenger conversation back to its start and capture every message for local export.',
  permissions: ['storage', 'tabs', 'webNavigation', 'scripting'],
  // Both surfaces, because the same conversation is reachable under either and
  // is meant to resolve to one thread.
  host_permissions: ['*://*.messenger.com/*', '*://*.facebook.com/*'],
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Messenger Capture',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['*://*.messenger.com/*', '*://*.facebook.com/messages/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
});
