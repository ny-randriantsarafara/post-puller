# Messenger Conversation Capture

Chrome extension (Manifest V3) that scrolls a Messenger thread back to its beginning,
captures every message idempotently, and exports the result as JSON. Targets both
surfaces a thread is reachable from: `messenger.com` and `facebook.com/messages`.

All captured data stays on your computer. The extension does not send data to any server.

## Status: parser only, not yet an extension

This package is being built parser-first, because the design depended on facts about
Messenger's DOM that could only be settled by reading a real one. What exists today:

- `src/content/parsing/` — reads a message element into a `ParsedMessage`
- `src/content/parsing/__fixtures__/` — four anonymized conversations, 44 messages
- [`DESIGN.md`](DESIGN.md) — the DOM findings and the decisions they settled

What does not exist yet: manifest, background worker, storage, popup, auto-scroll,
export. There is nothing to load into Chrome. The build and dev scripts are absent
rather than broken, and the remaining work is sequenced in `DESIGN.md`.

## Requirements

- Node.js 20+
- pnpm 10+

## Scripts

Run from this directory, or from the repository root with
`pnpm --filter @extractor/messenger <script>`.

```bash
pnpm test
pnpm test:watch
pnpm typecheck
pnpm lint
```

## What the parser reads

A Messenger message is a single element carrying its own identifier, sender, timestamp
and text in two attributes:

```
div[data-message-id][aria-roledescription="message"]
   [aria-label="At 16:15, Alex Moreau: hello"]
```

Three consequences worth knowing before touching this code, each explained at length in
[`DESIGN.md`](DESIGN.md):

**Text comes from the accessible name, not the DOM text.** A reply renders its quoted
parent inside the same element behind `aria-hidden`, so reading `div[dir="auto"]` returns
the quoted text of a *different* message. The `aria-label` excludes the quote by
construction.

**Messages have stable identifiers.** `data-message-id` survives reloads, in two formats
(`<accountId>@msgr.<messageId>` end-to-end, `mid.$<token>` otherwise). Deduplication keys
on it, so content hashing is a fallback rather than the primary key. React's own ids
(`:r7:`) are explicitly rejected: they change between renders and would re-import the
whole thread on every scan.

**Timestamps are display strings with no absolute form anywhere in the DOM.** `16:15` and
`Tuesday 14:51` resolve against the day of the capture and are flagged
`INFERRED_TIMESTAMP`; only `15 July 2026, 17:38` stands on its own. Because today's
`16:15` becomes `Tuesday 16:15` next week, a timestamp can never contribute to identity.

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

**Never commit a raw saved page.** They contain real conversations with people who did
not consent to being in a git history.

## Planned behaviour and its side effects

Not yet implemented, but decided, and listed here because they are the parts a user
deserves warning about rather than discovering:

- Capture drives **your own logged-in session**. It reads the page you are already
  looking at; it does not authenticate, and it cannot reach anything you cannot.
- Scrolling a thread **marks it as read** and may send read receipts to the other
  participant. This is unavoidable: it is what opening a conversation does.
- Auto-scroll is paced deliberately slowly, with jitter, no synthetic clicks, a hard
  pause while the tab is hidden, and exponential backoff. Messenger virtualises
  aggressively — one sampled thread held 560 recycled rows against 3 rendered — so
  capture reads mutations as they happen and scrolling faster loses messages.

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

## Project structure

```text
src/
  content/parsing/   message selectors, parser, and anonymized fixtures
  shared/types/      message and warning types
scripts/
  build-fixtures.mjs anonymizer for saved conversations
DESIGN.md            DOM findings and the design resting on them
```

## License

MIT
