# Extractor

Chrome extensions (Manifest V3) that capture what a page you already have open has
rendered, store it locally in IndexedDB, and export it as versioned JSON.

All captured data stays on your computer. Nothing is sent to any server, and the
`check:no-network` guard below enforces that at build time.

## Extensions

| Package | What it captures |
| --- | --- |
| [`apps/facebook-groups`](apps/facebook-groups/README.md) | Posts, comments and reactions from Facebook group feeds |
| [`apps/messenger`](apps/messenger/README.md) | Messages from a Messenger conversation, read back to its first message |

Each extension builds and loads on its own. Its README covers installing it, what it
captures, its export schema, and the side effects of running it.

## Shared packages

The two extensions are the same machine pointed at different sites. What is generic lives
in packages, and what is site-specific lives in the app:

| Package | Contents |
| --- | --- |
| `packages/capture-core` | Capture domain, identity ladder, IndexedDB repository, messaging protocol, background coordinator, DOM observer and auto-scroller |
| `packages/capture-ui` | Popup components shared by both extensions, under `cui-` prefixed classes |
| `packages/tsconfig` | TypeScript presets for browser, node and test projects |
| `packages/eslint-config` | ESLint presets, with and without React |

A site is defined by two objects. `CaptureDomain` says what an item is, how it is stored
and how two sightings of it compare; it holds no DOM code, which is what keeps parsers and
selectors out of the service worker's module graph. `SiteAdapter` is the DOM half: how to
find items, how to read one, what to scroll, and when a scan should stop.

Adding a third extractor should be a matter of writing those two objects.

## Requirements

- Node.js 20+
- pnpm 10+
- Google Chrome or Chromium

## Scripts

```bash
pnpm install
pnpm verify            # lint, typecheck, test, no-network guard, build
pnpm build             # every workspace
pnpm test              # unit tests, every workspace
pnpm test:e2e          # Playwright, one workspace at a time
pnpm check:no-network  # fails on fetch, XMLHttpRequest, WebSocket, sendBeacon
```

To work in one package, filter it:

```bash
pnpm --filter @extractor/messenger build
pnpm --filter @extractor/capture-core test
```

Workspace packages are consumed as TypeScript source rather than built output, so there is
no build step between changing a package and seeing it in an extension.

## License

MIT
