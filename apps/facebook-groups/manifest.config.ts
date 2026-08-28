import { defineManifest } from '@crxjs/vite-plugin';
import packageJson from './package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'Facebook Group Post Capture',
  version: packageJson.version,
  description:
    'Capture visible Facebook group posts and comments for local export and analysis.',
  permissions: ['storage', 'tabs', 'webNavigation', 'scripting'],
  host_permissions: ['*://*.facebook.com/*'],
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Facebook Group Capture',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['*://*.facebook.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
});
