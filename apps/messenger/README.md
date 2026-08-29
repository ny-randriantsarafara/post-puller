# Messenger Conversation Capture

Chrome extension (Manifest V3) that scrolls a Messenger thread back to its beginning,
captures every message idempotently, and exports the result as JSON. Targets both
surfaces a thread is reachable from: `messenger.com` and `facebook.com/messages`.

All captured data stays on your computer. The extension does not send data to any server.

## Requirements

- Node.js 20+
- pnpm 10+
- Google Chrome or Chromium

## Install for development

Run from this directory, or from the repository root with
`pnpm --filter @extractor/messenger <script>`.

```bash
pnpm install
pnpm build
```

Load the unpacked extension from the generated `dist` directory:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist` folder

For development with hot reload:

```bash
pnpm dev
```

## Usage

1. Open a conversation, on either `https://www.messenger.com/t/<id>` or
   `https://www.facebook.com/messages/t/<id>`
2. Click the extension icon
3. Choose **Manual scan** or **Automatic scan**
4. Set the scan options if you want the scan bounded
5. Click **Start scan**
6. Scroll the conversation upward yourself, or let the automatic scan do it
7. Click **Stop scan** when finished
8. Click **Preview messages**, or **Export** next to the conversation

Captured messages stay in IndexedDB after the popup closes. The popup shows the count for
the conversation in the current tab, the count across every conversation, and a warning
banner for anything that makes an export say less than it appears to.

While a scan runs it also reports what that scan saw against what it managed to read. The
two numbers differ because Messenger recycles a message row out of the DOM as it scrolls
away, sometimes before the batch that was going to read it gets there. A scan that reads
most of what it sees is working normally; one that can read *none* of it has selectors
that no longer match the page, which without this number is indistinguishable from a
conversation with nothing left to capture.

### Scan modes

**Manual scan** only watches the conversation: you scroll.

**Automatic scan** scrolls the conversation upward for you, roughly two thirds of a panel
every 1.5 seconds. Messenger recycles a message out of the DOM as soon as it leaves the
viewport — one sampled thread held 560 recycled placeholders against 3 rendered messages —
so capture reads mutations as they happen, and scrolling faster loses messages. Scrolling
pauses while the tab is hidden, because Chrome throttles timers in background tabs, so
keep the conversation visible.

Capture keeps running after the scrolling stops, so anything Messenger loads later is
still stored. Stopping the scan is always up to you.

### Scan options

**Capture reactions** (on by default) stores the emoji and count read from each reaction
pill.

**Capture attachment details** (on by default) stores attachment metadata. Files are never
downloaded.

**Stop after N messages** and **Stop at a day** bound a scan. A conversation of 100 000
messages takes about two hours, and no pacing change fixes that safely, so a long history
is meant to be captured in bounded passes: a re-scan stores nothing it already holds, so
running one repeatedly is free of duplicates.

### Why a scan stopped

The thread record keeps the reason, and it is what decides whether an export calls itself
complete:

| Reason | Meaning |
| --- | --- |
| `reachedStart` | The panel is at its top. The conversation was read to its first message. |
| `blocked` | Nothing more loads, yet the panel is not at its top. Scroll it by hand for a moment, then scan again. |
| `userLimit` | A bound you set, or **Stop scan**. |
| `timeCap` | The scan ran for three hours. This bound is not configurable: a scan drives your own logged-in session, and automation that runs unbounded on it is the risk worth capping. |
| `interrupted` | The tab navigated away or was refreshed mid-scan. |

Only `reachedStart` marks the history complete, and once a conversation has been read back
to its first message a later partial scan cannot downgrade that.

## JSON export schema (v1)

Export writes **one file per conversation**. The file name uses the conversation title and
the window of the messages inside it, for example
`alex-moreau_2026-07-15_2026-08-19.json`. When no message has a resolved date, the export
day is used instead: `alex-moreau_export-2026-08-29.json`.

The conversation is read a page at a time and each page is appended to the file, so a
thread of any length costs one page of memory rather than the whole file twice over. The
fields below are shown indented for reading; the file itself is written with one message
per line, which keeps it greppable without spending a fifth of its bytes on indentation.
Messages are in the order they are stored: oldest first, with any message whose date never
resolved at the end.

```json
{
  "schemaVersion": 1,
  "extensionVersion": "0.1.0",
  "exportedAt": "2026-08-29T09:00:00.000Z",
  "thread": {
    "threadId": "61550123456789",
    "threadIdSource": "numeric",
    "title": "Alex Moreau",
    "aliases": ["61550123456789", "alex.moreau"],
    "isEncryptedThread": false,
    "messageCount": 2,
    "unresolvedTimestampCount": 0,
    "reachedThreadStart": true,
    "lastStopReason": "reachedStart",
    "firstScannedAt": "2026-08-29T08:00:00.000Z",
    "lastScannedAt": "2026-08-29T09:00:00.000Z",
    "oldestSentAt": "2026-07-15T17:38:00.000Z",
    "newestSentAt": "2026-08-19T12:00:00.000Z"
  },
  "conversationWindow": {
    "earliest": "2026-07-15T17:38:00.000Z",
    "latest": "2026-08-19T12:00:00.000Z"
  },
  "stats": {
    "messageCount": 2,
    "incompleteMessageCount": 0,
    "unresolvedTimestampCount": 0,
    "reactionCount": 1,
    "attachmentCount": 0
  },
  "warnings": [],
  "messages": []
}
```

Each message includes the sender, the displayed timestamp and the resolved `sentAt`, the
text, reactions, attachment metadata, capture timestamps, and its own warnings.

The envelope's `warnings` are computed from the records rather than stored, so an export
cannot drift from what it was built from:

| Warning | Meaning |
| --- | --- |
| `INCOMPLETE_HISTORY` | Scrolling stopped before the first message of the conversation. |
| `ENCRYPTED_THREAD` | An end-to-end encrypted conversation. Its content was in the page and is therefore in this file. |
| `UNRESOLVED_TIMESTAMPS` | Some messages carry no resolved date, so ordering them is a guess. |
| `INFERRED_TIMESTAMPS` | Some dates were read against the clock of the machine that captured them. |
| `UNSTABLE_IDENTITIES` | Some messages are keyed by a hash of their content rather than by an id. |

## How messages are deduplicated

Each message is stored under one identity:

1. `data-message-id`, which survives reloads, in two formats
   (`<accountId>@msgr.<messageId>` end-to-end, `mid.$<token>` otherwise)
2. A hash of the conversation id, the sender, the text, and a duplicate index

The first is the common path. React's own ids (`:r7:`) are explicitly rejected: they change
between renders, and a scan keyed on one would re-import the whole conversation every pass.

**A timestamp never contributes to identity.** Messenger has no absolute timestamp anywhere
in the DOM, only display strings, and today's `16:15` becomes `Tuesday 16:15` next week.
Keying on one would store the same message twice a week later.

The duplicate index is what separates three identical `ok` replies from the same person
into three records instead of collapsing them into one. It is bounded at 50 000 entries per
scan; past that, identical short messages stop being separable and say so with
`DUPLICATE_INDEX_OVERFLOW` rather than being silently merged.

### One conversation, two ids

The same conversation is reachable under a numeric id and under a vanity handle, and under
two origins. A conversation already captured under one keeps writing to those records when
reached by the other: the id it was first stored under stays canonical, and the other is
recorded as an alias. Re-keying the messages instead would change the content hashes that
some of them are stored under, which would re-import the conversation.

## How timestamps are resolved

A message carries a display string, not a date. The separators Messenger renders between
message groups carry the day, so a message takes its date from the nearest separator above
it. The anchor index is rebuilt before each batch, because scrolling upward parses a day's
messages before the separator that dates them is rendered.

A message that could only be dated against the capture clock is flagged
`INFERRED_TIMESTAMP`. One that could not be dated at all is flagged
`UNRESOLVED_TIMESTAMP`, sorts to the end of its conversation, and is counted in the
popup and in the export.

## Fixtures

Unit tests run against four real conversations, anonymized by
[`scripts/build-fixtures.mjs`](scripts/build-fixtures.mjs). Structure, roles, nesting,
timestamps and identifier *formats* are untouched, which is the only reason testing on
them is worth anything. Names, message bodies and identifier *values* are synthetic.

The scrubber works by allowlist, not blocklist: it rebuilds the label shapes it
recognises, then replaces every word outside Messenger's own interface vocabulary. A
label shape nobody anticipated degrades into lorem rather than leaking a sentence
somebody wrote.

To refresh fixtures after a Messenger change:

1. Open a conversation in Chrome while logged in
2. Save it with **Save as → Webpage, Complete**
3. Run `node scripts/build-fixtures.mjs ~/Downloads/thread.html thread-name`
4. Read the generated file before committing it, and confirm no real name, message,
   account id or URL survived
5. Run `pnpm test`

End-to-end coverage runs against
[`tests/fixtures/thread-page.html`](tests/fixtures/thread-page.html), which prepends older
message groups as the panel is scrolled upward and recycles the rows that fall well below
the viewport. A scan therefore has to reach the top of the conversation to see all of it,
and has to read each message as it arrives: by the end, most of the conversation is no
longer in the page.

**Never commit a raw saved page.** They contain real conversations with people who did
not consent to being in a git history.

## Side effects you deserve warning about

- Capture drives **your own logged-in session**. It reads the page you are already
  looking at; it does not authenticate, and it cannot reach anything you cannot.
- Scrolling a conversation **marks it as read** and may send read receipts to the other
  participant. This is unavoidable: it is what opening a conversation does.
- End-to-end encrypted conversations are decrypted by the page, so their content *is* in
  the DOM and is captured. The popup says so and the export flags it, so that nobody
  discovers it by accident.
- Attachment URLs served from `fbcdn`/`fbsbx` are signed and expire within hours or days.
  An export is not a durable media archive.

## Privacy

Conversations contain personal data about third parties who have not consented to being
extracted. That is a question about how you use this, not one the code can answer. What
the code does guarantee: nothing leaves your machine, and the fixtures in this repository
contain no real content.

## Out of scope

- Reading conversations you are not a participant in
- Fetching history through Messenger's private APIs rather than the rendered page
- Downloading image, video, or voice attachments
- Sending, editing, reacting to, or deleting messages
- Bypassing login, CAPTCHA, or rate limiting

## Scripts

```bash
pnpm dev
pnpm build
pnpm test
pnpm test:e2e
pnpm typecheck
pnpm lint
```

The no-network guard covers every workspace at once and therefore lives at the repository
root: `pnpm check:no-network`.

## Project structure

```text
src/
  background/        service worker, capture coordinator, thread requests
  content/           thread detection, site adapter, scan bounds, parsing
  popup/             scan controls and per-conversation list
  preview/           message browser and export
  shared/            domain, identity, storage, messaging, export
tests/
  e2e/               Playwright smoke tests
  fixtures/          end-to-end HTML fixtures
scripts/
  build-fixtures.mjs anonymizer for saved conversations
DESIGN.md            DOM findings and the design resting on them
```

## License

MIT
