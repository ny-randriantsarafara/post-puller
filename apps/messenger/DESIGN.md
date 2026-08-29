# Messenger conversation capture — design

A second Chrome extension built on `@extractor/capture-core`: it scrolls a Messenger
thread back to its beginning, captures every message idempotently, and exports the
result as JSON. This document records the DOM the design rests on, and which of it has
actually been checked.

The plan called the selector table "a hypothesis to falsify, not a specification".
The tables below are no longer a hypothesis: they were read off four saved
conversations and are enforced by `src/content/parsing/parseMessage.test.ts`. Where a
question is still open, it says so.

## Reconnaissance

Four conversations were saved from Chrome (**Save as → Webpage, Complete**) and turned
into fixtures by `scripts/build-fixtures.mjs`. They cover 44 messages in total:

| Fixture | Messages | What it exercises |
| --- | --- | --- |
| `thread-same-day.html` | 15 | Clock-only timestamps, replies, hover chrome |
| `thread-weekday-dates.html` | 11 | Weekday timestamps, attachments, a shared story, text-less messages, the `mid.$…` id format |
| `thread-absolute-dates.html` | 3 | Absolute timestamps, a group thread, heavy virtualization (560 recycled rows against 3 rendered) |
| `thread-reactions.html` | 15 | Reactions, dense same-minute bursts |

All four were captured from an English-language UI.

### Anonymisation

The saved pages are real conversations with real people in them and are never
committed. The fixtures are: structure, roles, nesting, timestamps and identifier
*formats* are the real thing, while names, message bodies and identifier *values* are
synthetic.

The scrubber works by allowlist, not blocklist. It rebuilds the label shapes it knows,
then replaces every word that is not part of Messenger's own interface vocabulary. A
label shape nobody anticipated therefore degrades into lorem instead of leaking a
sentence somebody wrote. Identifiers are rebuilt at the same length over a synthetic
alphabet, preserving the format a parser matches on — including the fact that an
end-to-end thread repeats one account id across every message.

Regenerate with:

```bash
node scripts/build-fixtures.mjs ~/Downloads/thread.html thread-name
```

## What the DOM actually looks like

A message is **one element**, and it carries its own identifier, sender, timestamp and
text in two attributes. Nothing has to be reassembled from the subtree:

```
div[role="log"]
  … 8 levels of layout divs …
    div[data-virtualized="true|false"]        ← the recycling unit
      div[role="article"]                     ← carries nothing worth reading
        div
          div[data-message-id]                ← the message
             [aria-roledescription="message"]
             [data-scope="messages_table"]
             [aria-label="At 16:15, Alex Moreau: hello"]
```

### Selector table

| What | Selector | Confidence |
| --- | --- | --- |
| Thread log | `div[role="log"]` | Present in all four samples |
| Message | `div[data-message-id][aria-roledescription="message"]` | 44/44, exactly 1:1 with `role="article"` |
| Recycled row | `[data-virtualized="true"]` | 564 across the samples, 560 of them in one |
| Time separator | `[data-scope="date_break"]` | 10 |
| Reply indicator | `div[role="button"][aria-label="Go to replied message"]` | 13 |
| Reaction | `div[role="button"][aria-label*="reaction"]` | 13 |
| Attachment | `a[role="link"][aria-label^="Open attachment,"]` | 1 — thin evidence |
| Shared story | `a[role="link"][aria-label="View Story"]` | 1 — thin evidence |
| Hover chrome to ignore | `div[role="toolbar"][aria-label="Message actions"]` | 44, one per message |

`role="row"` does **not** exist on this surface, and `role="article"` holds no
attributes, so the row with `data-message-id` is the anchor for everything.

### The accessible name is the text source

Every message carries its facts twice:

```
At 16:15, Alex Moreau: hello                          (on the row)
Enter, Message sent 16:15 by Alex Moreau: hello       (on the focusable bubble)
```

Both parse; the parser reads the row and falls back to the bubble. A message with no
text — a lone attachment or a sticker — stops after the sender, so the body is
optional in both patterns.

**Read the label, not the DOM text.** When a message is a reply, the quoted parent is
rendered inside the same row, inside `span[aria-hidden="true"]`. Scraping
`div[dir="auto"]` therefore returns the quoted text of *another* message, and in one
sampled row returned the quote while the body lived elsewhere entirely. The accessible
name excludes the quote by construction, which is exactly the disambiguation needed.

Sender direction has no class or attribute behind it: Messenger names the reader
`You`, and that string is the only signal. It is modelled as
`{ kind: 'self' } | { kind: 'other', name }` rather than left as a magic string
comparison.

## Decisions the reconnaissance settled

### Identity level 2 is attainable

This was the open question that gated the design. Every message carries a
`data-message-id`, stable across reloads, in one of two formats:

| Format | Example shape | Seen in |
| --- | --- | --- |
| End-to-end | `<accountId>@msgr.<messageId>` | 3 threads |
| Ordinary | `mid.$<token>` | 1 thread |

The plan guessed a bare `/^\d{15,}$/` for the first; the real value is a compound
`digits@msgr.digits`, and `MESSAGE_ID_PATTERNS` matches what the DOM actually contains.
React's own ids (`:r7:`, `«r3»`) never appeared in this attribute, but they are
explicitly rejected: they change between renders and a scan keyed on one would
re-import the whole thread on every pass.

The consequence is that the `dupIndex` scheme — bucketing by thread, minute, sender and
content — is a **fallback for messages with no usable id**, not the primary key. That
removes the bounded-blast-radius compromise from the common path entirely.

### The thread virtualises, so capture must be mutation-driven

One sample held 560 `data-virtualized="true"` placeholders against 3 rendered messages.
Messages are recycled out of the DOM as they leave the viewport, which rules out
reading a final snapshot and confirms the mutation-driven design the core already has.
`findMessageElements` skips placeholders so a recycled row is never read as a blank.

### The element that scrolls is inside the log, not above it

A saved page has no live layout, so this one had to be measured in an authenticated tab.
The result contradicts the assumption the plan was written under: the scrolling element
is a **descendant** of `[role="log"]`, two levels below it, and carries `role="none"`.
Walking upward from the log finds nothing, which is precisely how automatic scanning came
to resolve no scroll target and stop on its first step.

It cannot be identified by overflowing content either. The same live log held **97
descendants** whose `scrollHeight` exceeded their `clientHeight` while computing
`overflow-y: visible`; those overflow visibly and ignore `scrollBy` entirely. The one
element that answers is the one that both declares a scrollable overflow and holds
message rows, and searching the whole 983-element subtree for it costs 0.36ms — far
below the 1.5s between scroll steps.

Driving it upward confirmed the rest of the design: on reaching the top, Messenger
prepends history and the offset jumps back down (`scrollHeight` 2122 → 3516 → 5297).
A stall check on `scrollTop` alone would read that jump as progress lost, which is why
`hasStalled` measures `scrollHeight - scrollTop` instead.

### One content script sees several conversations

Clicking a conversation in the sidebar is a `pushState` navigation: the document is never
replaced, so the content script that was loaded for the first conversation keeps running
for every conversation opened after it. `popstate` does not help — it fires only for the
back and forward buttons, never for `pushState` — so a script that resolves "the current
thread" once holds an id that silently becomes wrong.

That is why the canonical thread id is stored together with the id it was resolved for
and is used only while the URL still names that conversation. Without the pairing, a scan
of the second conversation writes its messages under the first, the popup reports nothing
captured for the conversation on screen, and `RECORD_THREAD_SCAN` then records the second
id as an *alias* of the first — which makes the mix-up permanent for both.

The service worker has the same problem in a different form. A batch carries its thread id
in the messages themselves, but stopping or interrupting a scan carries no messages, so
the thread has to come from the session's URL. Falling back to the most recently scanned
thread, as it first did, attributes one conversation's stop reason to another.

### There is no absolute timestamp in the DOM

No `title`, no `datetime`, no `<time>` element anywhere in any sample. Timestamps exist
only as display strings, in three shapes:

| Shape | Example | Self-contained |
| --- | --- | --- |
| Clock time | `16:15` | No — relative to the capture day |
| Weekday and clock time | `Tuesday 14:51` | No — relative to the capture week |
| Absolute | `15 July 2026, 17:38` | Yes |

Only the third parses with `Date.parse`; the other two return `NaN`. Core's
`parseRelativeDate` targets Facebook's `2 hours ago` idiom and matches none of them, so
`parseMessageTimestamp` is Messenger's own.

Two consequences. A resolved instant from the first two shapes is only as good as the
clock that read it, so those messages are flagged `INFERRED_TIMESTAMP`. And because the
displayed value for one message changes as days pass — today's `16:15` becomes
`Tuesday 16:15` next week — **a timestamp can never contribute to identity**. This is
the second reason `data-message-id` matters rather than being a convenience.

The visible `date_break` separators use abbreviated forms (`Tue 20:06`, `15 Jul 2026,
17:38`) while the accessible names use full ones (`Tuesday`, `July`). The parser reads
the accessible names.

### Counts are kept by the write, not recovered by reading

A batch lands about once a second and the popup polls between them. Answering either by
building the counts from the store means reading and validating every stored record, so a
long conversation is scanned once per batch and twice a second on top of that: the cost of
knowing how much is stored grows with how much is stored.

The write is the only place that holds both the record that was there and the record that
replaced it, which is what a count actually needs — a re-sighting adds no message but can
turn an incomplete one complete. So `upsertItems` returns that difference per conversation
and the session's totals are moved by it. A full count happens where the user is already
waiting: starting a scan, clearing data.

Kept rather than derived, totals can fall behind whatever writes without going through a
scan. `GET_SESSION` therefore compares them against a *count of the keys* in the store,
which does not deserialise the records under them, and recounts properly only when the two
disagree. It writes the session only when something changed, so a popup left open is no
longer a write to `chrome.storage.local` twice a second.

## Still open

Not contradicted by the samples, but not confirmed by them either:

- **Locale variants.** All four samples came from an English UI. The Facebook extension
  needed French patterns throughout, so Messenger almost certainly does too; `At …, X:`
  and `Enter, Message sent … by X:` are the strings to re-derive per locale.
- **Multi-reaction labels.** All 13 reactions observed were `1 reaction with <emoji>;
  see who reacted to this.`. The plural and aggregated forms are guessed by
  `REACTION_LABEL`.
- **Attachment kinds.** One file attachment and one shared story across 44 messages.
  Photos, videos, voice notes and stickers are unsampled, and `MessageAttachment` will
  almost certainly need to grow.
- **System notices.** Unsent messages, member changes and call notices did not appear,
  beyond one `You created this group`.
- **Thread identity.** The saved URL confirms `/t/<id>` on both surfaces, but alias
  promotion between vanity and numeric ids needs a live session to exercise.

The storage design is unchanged from the plan; nothing found here contradicts it.
