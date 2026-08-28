import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    // pnpm gives each package its own React copy otherwise, which surfaces as
    // "Invalid hook call" the moment a shared component renders.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    fs: {
      // Workspace packages are consumed as source, so the dev server has to be
      // allowed to serve files from outside this app.
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
  build: {
    rollupOptions: {
      input: {
        popup: 'src/popup/index.html',
        preview: 'src/preview/index.html',
      },
    },
  },
});
