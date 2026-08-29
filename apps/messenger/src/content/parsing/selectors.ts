// Every selector here was checked against four saved conversations, kept as
// fixtures in __fixtures__. What the samples showed, in short: a message is one
// element, and that element carries its own identifier, sender, timestamp and
// text in two attributes. Nothing needs to be reassembled from the subtree.
export const SELECTORS = {
  log: 'div[role="log"]',

  // The message element. role="article" wraps it two levels up, but the article
  // holds no attributes worth reading, so the row is the anchor for everything.
  messageRow: 'div[data-message-id][aria-roledescription="message"]',

  // A row whose content has been recycled out of the DOM. One sample had 560 of
  // these against 3 rendered messages, which is why a scan reads mutations as
  // they happen rather than a final snapshot.
  virtualizedPlaceholder: '[data-virtualized="true"]',

  // Messenger's own name for the time separators between message groups. The
  // text is a clock time as often as it is a date.
  dateBreak: '[data-scope="date_break"]',

  repliedMessageButton: 'div[role="button"][aria-label="Go to replied message"]',
  reactionButton: 'div[role="button"][aria-label*="reaction"]',
  attachmentLink: 'a[role="link"][aria-label^="Open attachment,"]',
  storyLink: 'a[role="link"][aria-label="View Story"]',

  // Hover chrome that lives inside the row and must never be read as content.
  messageActionsToolbar: 'div[role="toolbar"][aria-label="Message actions"]',
} as const;

// "At 16:15, Alex Moreau: hello" on the row itself. A message with no text - a
// lone attachment, a sticker - stops after the sender, hence the optional body.
export const MESSAGE_LABEL = /^At (.+?), ([^:]+?)(?:: ([\s\S]*))?$/;

// The same three facts appear a second time on the focusable bubble, as
// "Enter, Message sent 16:15 by Alex Moreau: hello". Read only if the row label
// is missing, so a future layout change has a fallback rather than a blank.
export const SENT_MESSAGE_LABEL =
  /^Enter, Message sent (.+?) by ([^:]+?)(?:: ([\s\S]*))?$/;

// What Messenger calls the reader. It is the only direction signal in the DOM:
// there is no outgoing/incoming class or attribute worth relying on.
export const SELF_SENDER_NAMES = ['You'];

// "1 reaction with ❤️; see who reacted to this."
export const REACTION_LABEL = /^(\d[\d,.\s]*) reactions? with (\S+)/;

// data-message-id, in the two formats the samples contained: an end-to-end
// thread repeats the account id on every message, an ordinary thread does not.
// Both are stable across reloads, which is what makes them usable as identity.
export const MESSAGE_ID_PATTERNS = [
  /^\d{6,}@msgr\.\d{6,}$/,
  /^mid\.\$[A-Za-z0-9_-]{10,}$/,
];

// React's own ids (":r7:", "«r3»") change between renders. They never appeared
// in data-message-id, but a selector that widens to any id attribute would pick
// them up, and a scan keyed on one would re-import the whole thread every time.
export const REJECTED_ID_PATTERNS = [/^:r[0-9a-z]+:$/i, /^«r[0-9a-z]+»$/i];

// The three shapes a message timestamp takes, narrowest first. Only the third
// is self-contained; the other two are relative to the day of the capture.
export const MESSAGE_TIMESTAMP_PATTERNS = {
  clockTime: /^(\d{1,2}):(\d{2})$/,
  weekdayAndClockTime: /^([A-Za-z]+) (\d{1,2}):(\d{2})$/,
  absolute: /^(\d{1,2}) ([A-Za-z]+) (\d{4}), (\d{1,2}):(\d{2})$/,
} as const;

// The separators rendered between message groups. They use abbreviated names
// where the accessible names on the messages use full ones, and the first shape
// carries no date at all - which is why a separator can anchor a message only
// sometimes, and why the messages keep their own timestamps regardless.
export const DATE_SEPARATOR_PATTERNS = {
  clockTime: /^(\d{1,2}):(\d{2})$/,
  weekdayAndClockTime: /^([A-Za-z]{3,}) (\d{1,2}):(\d{2})$/,
  absolute: /^(\d{1,2}) ([A-Za-z]{3,}) (\d{4}),? (\d{1,2}):(\d{2})$/,
} as const;

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
