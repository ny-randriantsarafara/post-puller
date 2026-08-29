import {
  resolveThreadIdSource,
  type ThreadIdSource,
} from '../shared/types/thread';
import { SELECTORS } from './parsing/selectors';

export type { ThreadIdSource };

// A thread is reachable under two origins with different path prefixes, and the
// <id> segment is the same under both. Stripping the origin and the prefix is
// therefore all it takes to recognise one conversation across both surfaces.
const THREAD_PATH_PATTERNS = [
  /^\/t\/([^/?#]+)/,
  /^\/messages\/t\/([^/?#]+)/,
  /^\/e2ee\/t\/([^/?#]+)/,
  /^\/messages\/e2ee\/t\/([^/?#]+)/,
];

const ENCRYPTED_PATH_PATTERN = /^(?:\/messages)?\/e2ee\/t\//;

export type ThreadTarget = {
  readonly isThreadPage: boolean;
  readonly threadId: string | null;
  readonly threadIdSource: ThreadIdSource | null;
  readonly threadTitle: string | null;
  readonly isEncryptedThread: boolean;
};

const NO_THREAD: ThreadTarget = {
  isThreadPage: false,
  threadId: null,
  threadIdSource: null,
  threadTitle: null,
  isEncryptedThread: false,
};

function readThreadIdFromPath(pathname: string): string | null {
  for (const pattern of THREAD_PATH_PATTERNS) {
    const match = pattern.exec(pathname);
    const threadId = match?.[1];
    if (threadId !== undefined && threadId.length > 0) {
      return decodeURIComponent(threadId);
    }
  }

  return null;
}

export { resolveThreadIdSource };

function readThreadTitle(documentLike: Document): string | null {
  const log = documentLike.querySelector(SELECTORS.log);
  const label = log?.getAttribute('aria-label')?.trim();
  if (label !== undefined && label.length > 0) {
    return label;
  }

  const headingText = documentLike.querySelector('[role="heading"]')?.textContent;
  if (headingText === undefined) {
    return null;
  }

  const heading = headingText.trim();
  if (heading.length > 0) {
    return heading;
  }

  return null;
}

export function resolveThreadTarget(
  locationLike: Location = window.location,
  documentLike: Document = document,
): ThreadTarget {
  const threadId = readThreadIdFromPath(locationLike.pathname);
  const threadTitle = readThreadTitle(documentLike);

  if (threadId === null) {
    return NO_THREAD;
  }

  return {
    isThreadPage: true,
    threadId,
    threadIdSource: resolveThreadIdSource(threadId),
    threadTitle,
    isEncryptedThread: ENCRYPTED_PATH_PATTERN.test(locationLike.pathname),
  };
}

// The generic capture layer speaks of collections, and a thread is what a
// Messenger collection is. The URL is normalised to one surface so the same
// conversation reported from messenger.com and from facebook.com groups together.
export function resolveThreadPageTarget(
  locationLike: Location = window.location,
  documentLike: Document = document,
): {
  isTargetPage: boolean;
  collectionName: string | null;
  collectionUrl: string | null;
} {
  const target = resolveThreadTarget(locationLike, documentLike);
  if (!target.isThreadPage || target.threadId === null) {
    return { isTargetPage: false, collectionName: null, collectionUrl: null };
  }

  return {
    isTargetPage: true,
    collectionName: target.threadTitle,
    collectionUrl: `https://www.messenger.com/t/${target.threadId}`,
  };
}

export function isThreadPage(locationLike: Location = window.location): boolean {
  return readThreadIdFromPath(locationLike.pathname) !== null;
}
