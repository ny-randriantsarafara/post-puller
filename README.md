# Facebook Group Post Capture

Chrome extension (Manifest V3) that captures visible Facebook group posts and comments from the page you already have open, stores them locally in IndexedDB, and exports a versioned JSON file for offline analysis.

All captured data stays on your computer. The extension does not send data to any server.

## Features

- Capture visible posts on Facebook group pages
- Detect newly loaded posts while you scroll manually, or let the extension scroll for you
- Expand rendered post text through scoped **See more** / **Voir plus** controls
- Deduplicate posts by Facebook post ID, normalized URL, or content hash, and recognise a
  post seen again under a changed content hash
- Continue capturing while the popup is closed
- Preview captured posts in a dedicated page
- Export a versioned JSON file
- Flag incomplete data such as truncated text or collapsed comments

## Requirements

- Node.js 20+
- Google Chrome or Chromium

## Install for development

```bash
npm install
npm run build
```

Load the unpacked extension from the generated `dist` directory:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist` folder

For development with hot reload:

```bash
npm run dev
```

Then load the extension from the `dist` folder created by Vite.

## Usage

1. Open a Facebook group page such as `https://www.facebook.com/groups/your-group`
2. Click the extension icon
3. Choose **Manual scan** or **Automatic scan**
4. Click **Start capture**
5. Scroll the group feed yourself, or let automatic scan do it
6. Click **Stop capture** when finished
7. Click **Preview results** or **Export JSON**

Captured data remains in IndexedDB after closing the popup.

### Per-group stats

The popup shows counts for the group in the current session at the top, and a **Stored by
group** breakdown underneath with every captured group, its post and incomplete counts,
and its publication date range. **Clear** removes one group only; **Clear all data** wipes
everything.

The preview page opens with the same per-group summary, a group filter for the post list,
and export that respects the selected group.

### Scan modes

**Manual scan** only watches the feed: you scroll.

**Automatic scan** scrolls the group for you, roughly two thirds of a screen every 1.5
seconds. The pace is deliberate: Facebook deletes a post from the page as soon as it leaves
the viewport, and capture needs up to a second to store what is on screen, so scrolling any
faster loses posts. Auto-scroll pauses while the tab is hidden, because Chrome throttles
timers in background tabs, so keep the group tab visible.

Auto-scroll stops on its own once four steps in a row neither move the page nor make it
longer, which means the feed has stopped loading. Capture keeps running after that, so
anything Facebook loads later is still stored. Stopping capture is always up to you.

Tabs opened before the extension was installed or reloaded do not run the content script
yet. **Start capture** injects it into the active tab when needed, so there is no need to
refresh the group tab first. If the tab still cannot be reached, the popup says so instead
of failing silently.

## JSON export schema (v2)

Export writes **one JSON file per captured group**. The file name uses the group slug and
the publication window of the posts inside it, for example
`sample-group_2026-08-05_2026-08-19.json`. When no post has a parsed publication date, the
export day is used instead: `sample-group_export-2026-08-19.json`.

```json
{
  "schemaVersion": 2,
  "extensionVersion": "0.1.0",
  "exportedAt": "2026-08-19T12:00:00.000Z",
  "group": { "name": "Sample Group", "url": "https://www.facebook.com/groups/sample-group" },
  "publicationWindow": {
    "earliest": "2026-08-05T08:00:00.000Z",
    "latest": "2026-08-19T11:00:00.000Z"
  },
  "stats": {
    "postCount": 2,
    "commentCount": 0,
    "incompletePostCount": 0
  },
  "posts": []
}
```

Each post includes:

- Post ID and canonical Facebook post URL when available
- Group name and URL
- Author name or anonymous label
- Post text
- Displayed relative label and parsed `publishedAt` ISO timestamp
- Reaction count
- Visible comments
- Attachment metadata
- Capture timestamps
- Incomplete-data warnings

`publishedAt` values derived from relative labels such as `1d`, `2 weeks ago`, or
`il y a 3 heures` are approximate. The original `displayedDate` label is kept alongside
the parsed timestamp.

## How posts are deduplicated

Each post is stored under one identity, chosen in this order:

1. Facebook post ID
2. Normalized post URL
3. Hash of author, text, and displayed date

The first two are stable. The third is not: Facebook reveals more text when **See more** is
clicked and ages the relative label from `2h` to `3h` as the session goes on, so the same
post can be seen twice under two different hashes. Every post therefore also carries a
`fingerprint`, built from the author and the first 60 characters of the message, which
neither expansion nor an ageing timestamp changes. Storage indexes it, so a post seen again
under a new hash updates the existing record instead of adding a second one, and a post
first stored under a hash moves to its Facebook ID as soon as a later sighting exposes one.

Two sightings that both carry a Facebook ID or URL and disagree on it are kept apart even
when their fingerprints match, so two genuinely different posts are never merged. What this
does not cover: a post shorter than 60 characters gets no fingerprint, and neither does a
photo-only post with no text, so those can still be stored twice if Facebook never gives
them an ID.

## Incomplete data warnings

The extension only works with posts Facebook has already rendered in the DOM. It clicks
text-only **See more** / **Voir plus** controls inside post message containers, but it
does not open comments, navigate to post pages, or download media files. Controls nested
in a link are never clicked, because navigating away would interrupt the session.

A post is always saved with the text available at capture time, and expansion is a
follow-up: when a click reveals more text, the post is saved again under the same
identity with the longer text. So an expansion Facebook refuses or ignores costs you the
full text of that post, never the post itself.

Facebook removes a post's content from the DOM once it scrolls out of the viewport. Posts
are therefore captured at most one second after they appear, and a post whose content is
already gone is skipped rather than stored as an empty record. Scrolling slowly enough for
posts to render keeps capture complete.

Common warnings:

- `TRUNCATED_TEXT`
- `COLLAPSED_COMMENTS`
- `HIDDEN_COMMENTS`
- `MISSING_POST_ID`
- `UNPARSED_DATE`

## Updating parser fixtures when Facebook changes

Facebook frequently changes its DOM. Parser selectors live in:

- [`src/content/parsing/selectors.ts`](src/content/parsing/selectors.ts)
- [`src/content/parsing/parsePost.ts`](src/content/parsing/parsePost.ts)
- [`src/content/parsing/parseComment.ts`](src/content/parsing/parseComment.ts)

Synthetic fixtures used by unit tests live in:

- [`src/content/parsing/__fixtures__/`](src/content/parsing/__fixtures__/)

To refresh fixtures from a real page:

1. Open a Facebook group in Chrome while logged in
2. Save the rendered HTML for one or more posts
3. Replace or add files under `src/content/parsing/__fixtures__/`
4. Keep ARIA-based structure such as `[role="feed"]` and `[role="article"]`
5. Run `npm test`

For end-to-end coverage, update [`tests/fixtures/group-page.html`](tests/fixtures/group-page.html)
for manual capture, or [`tests/fixtures/growing-group-page.html`](tests/fixtures/growing-group-page.html)
for automatic scan.

## Scripts

```bash
npm run dev
npm run build
npm test
npm run test:e2e
npm run lint
npm run check:no-network
```

## Local-only guarantee

- No analytics endpoints
- No remote code loading
- No outbound network calls in extension source (`npm run check:no-network`)
- Storage uses extension-local IndexedDB and `chrome.storage.local`
- Permissions are `storage`, `tabs`, `webNavigation`, and `scripting`, all limited to
  `*://*.facebook.com/*` by the host permissions

## Out of scope

- Opening collapsed comments or individual post pages
- Capturing unloaded content
- Server upload or in-extension analysis
- Bypassing login, CAPTCHA, or Facebook restrictions
- Downloading image or video files

## Project structure

```text
src/
  background/        service worker and capture coordinator
  content/           DOM parsing and feed observer
  popup/             capture controls
  preview/           preview and export UI
  shared/            types, storage, messaging, export helpers
tests/
  e2e/               Playwright smoke tests
  fixtures/          end-to-end HTML fixtures
```

## License

MIT
