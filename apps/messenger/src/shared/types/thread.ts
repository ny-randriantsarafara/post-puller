// The id in the URL is stable across surfaces but not within one: the same
// conversation is reachable under a numeric id and under a vanity handle. The
// numeric form is the stronger of the two.
export type ThreadIdSource = 'threadTitle' | 'vanity' | 'numeric';

const NUMERIC_THREAD_ID = /^\d{5,}$/;

export function resolveThreadIdSource(threadId: string): ThreadIdSource {
  if (NUMERIC_THREAD_ID.test(threadId)) {
    return 'numeric';
  }

  return 'vanity';
}

// A thread is reachable under two origins with different path prefixes, and the
// <id> segment is the same under both. Stripping the origin and the prefix is
// therefore all it takes to recognise one conversation across both surfaces.
const THREAD_PATH_PATTERNS = [
  /^\/t\/([^/?#]+)/,
  /^\/messages\/t\/([^/?#]+)/,
  /^\/e2ee\/t\/([^/?#]+)/,
  /^\/messages\/e2ee\/t\/([^/?#]+)/,
];

export const ENCRYPTED_THREAD_PATH = /^(?:\/messages)?\/e2ee\/t\//;

export function readThreadIdFromPath(pathname: string): string | null {
  for (const pattern of THREAD_PATH_PATTERNS) {
    const match = pattern.exec(pathname);
    const threadId = match?.[1];
    if (threadId !== undefined && threadId.length > 0) {
      return decodeURIComponent(threadId);
    }
  }

  return null;
}

// Lives here rather than in the content script because the service worker reads
// thread ids too: it holds the conversation a session was started on as a URL,
// and that is the only trustworthy name it has for the thread it writes to.
export function readThreadIdFromUrl(url: string | null): string | null {
  if (url === null) {
    return null;
  }

  try {
    return readThreadIdFromPath(new URL(url).pathname);
  } catch {
    return null;
  }
}

// Why a scan stopped, kept apart from whether it succeeded. Only the first one
// means the thread was read all the way back to its first message.
export const SCAN_STOP_REASONS = [
  'reachedStart',
  // Not at the top, yet nothing new loads. Reported as its own state because it
  // is actionable by the user, and reporting it as success would be a lie.
  'blocked',
  // The hard wall-clock bound on one scan. It exists because a scan drives the
  // user's own logged-in session, and automation that runs unbounded on it is
  // the risk this extension takes on their behalf.
  'timeCap',
  'userLimit',
  'interrupted',
] as const;

export type ScanStopReason = (typeof SCAN_STOP_REASONS)[number];

export function reachedThreadStart(stopReason: ScanStopReason): boolean {
  return stopReason === 'reachedStart';
}

// The per-thread record that lives beside the messages. It is what lets a
// re-scan know where it left off, and what carries the honesty flags an export
// has to reproduce.
export type CapturedThread = {
  threadId: string;
  threadIdSource: ThreadIdSource;
  title: string | null;
  // Every id this thread has been reached under. The same conversation is
  // reachable by numeric id and by vanity handle, so a thread first stored under
  // the weaker one is recognised here and promoted rather than duplicated.
  aliases: string[];
  isEncryptedThread: boolean;
  messageCount: number;
  unresolvedTimestampCount: number;
  reachedThreadStart: boolean;
  lastStopReason: ScanStopReason | null;
  firstScannedAt: string;
  lastScannedAt: string;
  oldestSentAt: string | null;
  newestSentAt: string | null;
};
