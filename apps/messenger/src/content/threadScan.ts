import type { CapturedMessage } from '../shared/types/capturedMessage';
import type { ScanOptions } from '../shared/types/scanOptions';
import type { ScanStopReason } from '../shared/types/thread';
import { resolveThreadScrollTarget } from './threadScrollTarget';
import { resolveThreadTarget } from './threadPage';

// What one run of a scan knows about itself: which thread it writes under, and
// how much of the conversation it has seen. Both are per-scan, because two scans
// can run in the same page without a reload.
export type ThreadScan = {
  // The id the scan's records are keyed under. It is resolved by the service
  // worker, which holds the storage, and is not the id in the URL when the same
  // conversation was first captured under a different handle.
  readonly canonicalThreadId: string | null;
  setCanonicalThreadId: (threadId: string | null) => void;
  beginScan: () => void;
  shouldKeepScrolling: (
    messages: readonly CapturedMessage[],
    options: ScanOptions,
  ) => boolean;
  onScrollingEnded: (didExhaustList: boolean, options: ScanOptions) => void;
};

// The hard bound on one scan, whatever the user asked for. A conversation of
// 100 000 messages takes about two hours to read, so this is not a limit a
// reasonable scan meets; it is the point past which automation is running on a
// live session for longer than anybody intended.
const MAX_SCAN_DURATION_MS = 3 * 60 * 60 * 1000;

// A message dated before the day the user asked to stop at. Compared by day
// rather than by instant, because that is the precision the option is set in.
function isOlderThanStopDate(message: CapturedMessage, stopAtDate: string): boolean {
  if (message.sentAt === null) {
    return false;
  }

  return message.sentAt.slice(0, 10) < stopAtDate;
}

// Only the page can tell a conversation that is genuinely at its first message
// from one that stopped answering, and the difference is the one the export
// reports as a complete or a partial history.
function resolveExhaustedStopReason(): ScanStopReason {
  const scrollTarget = resolveThreadScrollTarget();
  if (scrollTarget !== null && !scrollTarget.hasReachedEnd()) {
    return 'blocked';
  }

  return 'reachedStart';
}

function reportThreadScan(stopReason: ScanStopReason, threadId: string): void {
  const target = resolveThreadTarget();

  // The extension can be reloaded while this script still runs in the page,
  // which rejects the message rather than answering it. The thread record then
  // keeps the counts of the previous scan, which is a stale outcome rather than
  // a wrong one.
  void chrome.runtime
    .sendMessage({
      type: 'RECORD_THREAD_SCAN',
      threadId,
      aliases: target.threadId === null ? [] : [target.threadId],
      title: target.threadTitle,
      isEncryptedThread: target.isEncryptedThread,
      stopReason,
    })
    .catch(() => undefined);
}

export function createThreadScan(): ThreadScan {
  // Identity keys rather than a running total, because a re-render re-emits a
  // message as a better version of the same one and counting those would stop a
  // scan early.
  let seenIdentityKeys = new Set<string>();
  let canonicalThreadId: string | null = null;
  let scanStartedAt = Date.now();
  // Which bound the scan met. The scrolling stops on one call and is reported on
  // the next, so the reason has to survive between the two.
  let boundStopReason: ScanStopReason | null = null;

  function resolveBoundStopReason(
    messages: readonly CapturedMessage[],
    options: ScanOptions,
  ): ScanStopReason | null {
    if (Date.now() - scanStartedAt >= MAX_SCAN_DURATION_MS) {
      return 'timeCap';
    }

    if (
      options.stopAtMessageLimit !== null &&
      seenIdentityKeys.size >= options.stopAtMessageLimit
    ) {
      return 'userLimit';
    }

    const stopAtDate = options.stopAtDate;
    if (
      stopAtDate !== null &&
      messages.some((message) => isOlderThanStopDate(message, stopAtDate))
    ) {
      return 'userLimit';
    }

    return null;
  }

  return {
    get canonicalThreadId() {
      return canonicalThreadId;
    },

    setCanonicalThreadId: (threadId) => {
      canonicalThreadId = threadId;
    },

    beginScan: () => {
      seenIdentityKeys = new Set<string>();
      scanStartedAt = Date.now();
      boundStopReason = null;
    },

    shouldKeepScrolling: (messages, options) => {
      for (const message of messages) {
        seenIdentityKeys.add(message.identityKey);
      }

      boundStopReason = resolveBoundStopReason(messages, options);
      return boundStopReason === null;
    },

    onScrollingEnded: (didExhaustList) => {
      const threadId = canonicalThreadId ?? resolveThreadTarget().threadId;
      if (threadId === null) {
        return;
      }

      const stopReason = didExhaustList
        ? resolveExhaustedStopReason()
        : (boundStopReason ?? 'userLimit');

      reportThreadScan(stopReason, threadId);
    },
  };
}
