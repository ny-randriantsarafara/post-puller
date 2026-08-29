// Turns a saved Messenger conversation into a committable fixture.
//
// The saved pages are real conversations with real people in them, so they are
// never committed. This keeps the structure a parser cares about - roles,
// nesting, and the shape of every accessible name - while replacing the names
// and message bodies with synthetic ones. Run it against a page saved from
// Chrome with "Save as > Webpage, Complete":
//
//   node scripts/build-fixtures.mjs ~/Downloads/thread.html thread-name
//
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const [sourcePath, fixtureName] = process.argv.slice(2);

if (sourcePath === undefined || fixtureName === undefined) {
  console.error('usage: build-fixtures.mjs <saved-page.html> <fixture-name>');
  process.exit(1);
}

const KEPT_ATTRIBUTES = new Set([
  'role',
  'dir',
  'tabindex',
  'aria-label',
  'aria-hidden',
  'aria-busy',
  'aria-valuetext',
  'title',
  'datetime',
  'data-scope',
  'data-visualcompletion',
  // The only stable message identifier the DOM exposes, plus the two signals a
  // parser needs to tell a real message from a virtualised placeholder.
  'data-message-id',
  'aria-roledescription',
  'data-virtualized',
]);

const REPLACEMENT_NAMES = [
  'Alex Moreau',
  'Bea Lambert',
  'Chris Ferrand',
  'Dana Whitfield',
  'Eli Sorensen',
  'Fay Okonkwo',
];

const REPLACEMENT_WORDS = [
  'quibus',
  'anima',
  'tempus',
  'ferunt',
  'lucem',
  'nectar',
  'silva',
  'ratio',
  'unda',
  'certus',
  'mirum',
  'orbis',
];

const names = new Map();

// "You" is a role rather than a name: it is what the site calls the reader, and
// a parser keys on it to tell an outgoing message from an incoming one.
function replaceName(original) {
  const trimmed = original.trim();
  if (trimmed === 'You' || trimmed.length === 0) {
    return original;
  }

  const existing = names.get(trimmed);
  if (existing !== undefined) {
    return existing;
  }

  const replacement =
    REPLACEMENT_NAMES[names.size % REPLACEMENT_NAMES.length] ?? 'Sam Vitale';
  names.set(trimmed, replacement);
  return replacement;
}

// data-message-id comes in two flavours, and both embed real identifiers: an
// end-to-end thread uses "<accountId>@msgr.<messageId>", an ordinary one uses
// "mid.$<token>". Each is rebuilt at the same length over a synthetic alphabet
// so the format a parser matches on survives while the identifier does not. The
// account id is mapped once per thread rather than per message, because every
// message in a thread really does repeat it.
const MESSAGE_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const E2EE_MESSAGE_ID = /^(\d+)@msgr\.(\d+)$/;
const CLASSIC_MESSAGE_ID = /^mid\.\$(.+)$/;

// The seed is spelled out at the end rather than folded into every character,
// because a per-character shift repeats once the alphabet wraps and two
// messages would end up sharing an id - which is exactly what a fixture about
// deduplication must not do.
function withSeed(filler, length, seed) {
  const suffix = String(seed);
  return `${filler.slice(0, Math.max(0, length - suffix.length))}${suffix}`.slice(-length);
}

function syntheticDigits(length, seed) {
  const filler = Array.from({ length }, (_, index) => String((index * 7 + 3) % 10)).join('');
  return withSeed(filler, length, seed);
}

function syntheticAlphanumerics(length, seed) {
  const filler = Array.from(
    { length },
    (_, index) => MESSAGE_ID_ALPHABET[(index * 11 + 5) % MESSAGE_ID_ALPHABET.length],
  ).join('');
  return withSeed(filler, length, seed);
}

const accountIds = new Map();
const messageIds = new Map();

function replaceAccountId(original) {
  const existing = accountIds.get(original);
  if (existing !== undefined) {
    return existing;
  }

  const replacement = syntheticDigits(original.length, accountIds.size + 1);
  accountIds.set(original, replacement);
  return replacement;
}

function buildMessageId(original, seed) {
  const e2ee = E2EE_MESSAGE_ID.exec(original);
  if (e2ee !== null) {
    return `${replaceAccountId(e2ee[1])}@msgr.${syntheticDigits(e2ee[2].length, seed)}`;
  }

  const classic = CLASSIC_MESSAGE_ID.exec(original);
  if (classic !== null) {
    return `mid.$${syntheticAlphanumerics(classic[1].length, seed)}`;
  }

  return syntheticAlphanumerics(original.length, seed);
}

function replaceMessageId(original) {
  const existing = messageIds.get(original);
  if (existing !== undefined) {
    return existing;
  }

  const replacement = buildMessageId(original, messageIds.size + 1);
  messageIds.set(original, replacement);
  return replacement;
}

// Same length bucket and same word count as the original, so that anything
// keyed on text length or truncation still behaves like the real thing.
function synthesizeText(original, seed) {
  const words = original.trim().split(/\s+/).filter(Boolean);

  return words
    .map((word, index) => {
      const replacement =
        REPLACEMENT_WORDS[(seed + index) % REPLACEMENT_WORDS.length] ?? 'verbum';
      return replacement.slice(0, Math.max(2, Math.min(word.length, replacement.length)));
    })
    .join(' ');
}

const html = readFileSync(sourcePath, 'utf8');
const sourceDocument = new JSDOM(html).window.document;

const log = sourceDocument.querySelector('div[role="log"]');
if (log === null) {
  console.error(`No div[role="log"] found in ${sourcePath}`);
  process.exit(1);
}

const savedUrl = /saved from url=\(\d+\)(\S+)/.exec(html)?.[1] ?? '';

// Every message body in the thread, replaced once and reused everywhere it
// appears, because the same sentence shows up in the bubble and again inside
// two different accessible names.
const bodies = new Map();

function bodyReplacement(original) {
  const trimmed = original.trim();
  if (trimmed.length === 0) {
    return original;
  }

  const existing = bodies.get(trimmed);
  if (existing !== undefined) {
    return existing;
  }

  const replacement = synthesizeText(trimmed, bodies.size);
  bodies.set(trimmed, replacement);
  return replacement;
}

// The two accessible names Messenger gives a message: one on the row, one on
// the focusable bubble. A message carrying no text - a sticker, or a lone
// attachment - stops after the sender, so the body is optional.
const MESSAGE_LABELS = [
  /^(At .*?, )([^:]+)(?:(: )([\s\S]*))?$/,
  /^(Enter, Message sent .*? by )([^:]+)(?:(: )([\s\S]*))?$/,
];
const CONVERSATION_LABEL = /^(Messages in conversation with )(.+)$/;
const OPTIONS_LABEL = /^(.*(?:options|conversation|profile|Open) (?:for|with) )(.+)$/i;

function anonymizeMessageLabel(label) {
  for (const pattern of MESSAGE_LABELS) {
    const match = pattern.exec(label);
    if (match === null) {
      continue;
    }

    const [, prefix, sender, separator, body] = match;
    if (separator === undefined) {
      return `${prefix}${replaceName(sender)}`;
    }

    return `${prefix}${replaceName(sender)}${separator}${bodyReplacement(body)}`;
  }

  return null;
}

function anonymizeLabel(label) {
  const message = anonymizeMessageLabel(label);
  if (message !== null) {
    return message;
  }

  const conversation = CONVERSATION_LABEL.exec(label);
  if (conversation !== null) {
    return `${conversation[1]}${replaceName(conversation[2])}`;
  }

  const options = OPTIONS_LABEL.exec(label);
  if (options !== null) {
    return `${options[1]}${replaceName(options[2])}`;
  }

  return label;
}

for (const element of [log, ...log.querySelectorAll('[data-message-id]')]) {
  const messageId = element.getAttribute('data-message-id');
  if (messageId !== null) {
    element.setAttribute('data-message-id', replaceMessageId(messageId));
  }
}

// Names have to be mapped before any body is, so that a sender's name is never
// consumed as part of a message and replaced with lorem instead.
for (const element of [log, ...log.querySelectorAll('[aria-label]')]) {
  const label = element.getAttribute('aria-label');
  if (label !== null) {
    element.setAttribute('aria-label', anonymizeLabel(label));
  }
}

const TIME_ONLY = /^(\d{1,2}:\d{2}|[A-Z][a-z]{2} \d{1,2}:\d{2}|\d{1,2} \w+ \d{4},? \d{1,2}:\d{2})$/;
const KEPT_PHRASES = [
  'Loading...',
  'You created this group',
  'Enter, Conversation details',
  'Learn more',
];

function anonymizeTextNode(node) {
  const original = node.textContent ?? '';
  const trimmed = original.trim();

  if (trimmed.length === 0) {
    return;
  }

  // Separators and system notices are structure, not content: a parser reads
  // them to date a message or to know it reached the top of the thread.
  if (TIME_ONLY.test(trimmed) || KEPT_PHRASES.includes(trimmed)) {
    return;
  }

  const known = names.get(trimmed);
  if (known !== undefined) {
    node.textContent = original.replace(trimmed, known);
    return;
  }

  node.textContent = original.replace(trimmed, bodyReplacement(trimmed));
}

const walker = sourceDocument.createTreeWalker(log, 4 /* SHOW_TEXT */);
const textNodes = [];
while (walker.nextNode()) {
  textNodes.push(walker.currentNode);
}
for (const node of textNodes) {
  anonymizeTextNode(node);
}

// Everything above replaces what it recognises. This last pass is the opposite
// and is what actually makes the fixture safe: any word that is not part of
// Messenger's own vocabulary is replaced, so a label shape nobody anticipated
// degrades into lorem instead of leaking a sentence somebody wrote.
const STRUCTURAL_VOCABULARY = new Set(
  [
    // Month and weekday names appear in full inside accessible names and
    // abbreviated in the visible date separators, and both forms are structure.
    'Apr', 'April', 'Aug', 'August', 'Dec', 'December', 'Feb', 'February',
    'Jan', 'January', 'Jul', 'July', 'Jun', 'June', 'Mar', 'March', 'May',
    'Nov', 'November', 'Oct', 'October', 'Sep', 'Sept', 'September',
    'a', 'about', 'actions', 'add', 'admin', 'ago', 'all', 'an', 'and', 'answer',
    'as', 'at', 'attachment', 'audio', 'avatar', 'back',
    'busy', 'by', 'call', 'chat', 'chats', 'close', 'comment', 'connected',
    'conversation', 'created', 'day', 'days', 'details', 'edited', 'emoji',
    'encrypted', 'encryption', 'end', 'end-to-end', 'ended', 'Enter', 'few',
    'file', 'for', 'forwarded', 'Fri', 'Friday', 'from', 'go', 'group', 'hi',
    'hour', 'hours', 'in', 'is', 'just', 'Learn', 'like', 'link', 'loading',
    'Mark', 'members', 'menu', 'message', 'messages', 'Messenger', 'minute',
    'minutes', 'Mon', 'Monday', 'month', 'months', 'more', 'name', 'new', 'now',
    'of', 'on', 'open', 'options', 'other', 'others', 'people', 'person',
    'photo', 'pinned', 'Press', 'profile', 'react', 'reacted', 'reaction',
    'reactions', 'read', 'removed', 'replied', 'reply', 'said', 'Sat',
    'Saturday', 'Say', 'second', 'seconds', 'see', 'sent', 'set', 'shared',
    'started', 'sticker', 'story', 'Sun', 'Sunday', 'Tab', 'the', 'this',
    'Thread', 'Thu', 'Thursday', 'to', 'today', 'Tue', 'Tuesday', 'unsent',
    'video', 'view', 'was', 'Wed', 'Wednesday', 'week', 'weeks', 'who', 'with',
    'yesterday', 'you', 'your',
  ].map((word) => word.toLowerCase()),
);

const syntheticVocabulary = new Set(
  [...REPLACEMENT_NAMES.flatMap((name) => name.split(' ')), ...REPLACEMENT_WORDS].map(
    (word) => word.toLowerCase(),
  ),
);

const substitutions = new Map();

function substituteToken(token) {
  const lower = token.toLowerCase();
  const existing = substitutions.get(lower);
  const replacement =
    existing ??
    REPLACEMENT_WORDS[substitutions.size % REPLACEMENT_WORDS.length] ??
    'verbum';

  if (existing === undefined) {
    substitutions.set(lower, replacement);
  }

  const sized = replacement.slice(0, Math.max(2, Math.min(token.length, replacement.length)));
  return token[0] === token[0]?.toUpperCase()
    ? sized.charAt(0).toUpperCase() + sized.slice(1)
    : sized;
}

function scrubFreeText(value) {
  return value.replace(/[\p{L}][\p{L}\p{M}'’-]*/gu, (token) => {
    const lower = token.toLowerCase();
    if (STRUCTURAL_VOCABULARY.has(lower) || syntheticVocabulary.has(lower)) {
      return token;
    }

    return substituteToken(token);
  });
}

for (const element of [log, ...log.querySelectorAll('*')]) {
  for (const attribute of [...element.attributes]) {
    if (attribute.name === 'aria-label' || attribute.name === 'title') {
      element.setAttribute(attribute.name, scrubFreeText(attribute.value));
    }
  }
}

for (const node of textNodes) {
  const original = node.textContent ?? '';
  if (original.trim().length > 0) {
    node.textContent = scrubFreeText(original);
  }
}

// SVG keeps its lowercase local name in an HTML document, so this compares
// case-insensitively rather than against tagName as-is.
const DROPPED_TAGS = new Set(['script', 'style', 'link', 'img', 'svg', 'video', 'canvas']);

function pruneElement(element) {
  for (const child of [...element.children]) {
    if (DROPPED_TAGS.has(child.tagName.toLowerCase())) {
      child.remove();
      continue;
    }

    pruneElement(child);
  }

  for (const attribute of [...element.attributes]) {
    if (!KEPT_ATTRIBUTES.has(attribute.name)) {
      element.removeAttribute(attribute.name);
    }
  }
}

pruneElement(log);

const outputPath = join(
  dirname(new URL(import.meta.url).pathname),
  '..',
  'src',
  'content',
  'parsing',
  '__fixtures__',
  `${fixtureName}.html`,
);

mkdirSync(dirname(outputPath), { recursive: true });

const banner = [
  '<!--',
  '  Generated by scripts/build-fixtures.mjs from a saved Messenger page.',
  '  Names and message bodies are synthetic. Timestamps, roles and structure',
  '  are the real thing, which is the whole point of the fixture.',
  `  Source surface: ${savedUrl.replace(/\/t\/\d+/, '/t/<thread-id>')}`,
  '-->',
].join('\n');

writeFileSync(outputPath, `${banner}\n${log.outerHTML}\n`, 'utf8');

console.log(
  `${fixtureName}: ${String(log.querySelectorAll('div[role="article"]').length)} articles, ` +
    `${String(names.size)} names replaced, ${String(bodies.size)} bodies replaced`,
);
