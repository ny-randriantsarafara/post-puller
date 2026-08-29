import {
  createElementScrollTarget,
  type ScrollTarget,
  type SiteAdapter,
} from '@extractor/capture-core/content';
import { retainCapturedIdentity } from '@extractor/capture-core/identity';
import { isBetterCapturedMessage } from '../shared/captureQuality';
import {
  DuplicateMessageIndex,
  resolveMessageIdentity,
} from '../shared/identity/messageIdentity';
import type { CapturedMessage } from '../shared/types/capturedMessage';
import { buildSortKey } from '../shared/types/capturedMessage';
import type { ScanOptions } from '../shared/types/scanOptions';
import type { MessageWarning } from '../shared/types/warnings';
import { anchorMessageTimestamp } from './parsing/anchorMessageTimestamp';
import {
  buildDateAnchorIndex,
  type DateAnchor,
} from './parsing/parseDateSeparator';
import { findMessageElements, parseMessage } from './parsing/parseMessage';
import { SELECTORS } from './parsing/selectors';
import { resolveThreadPageTarget, resolveThreadTarget } from './threadPage';

// Bounded because it is the only thing that accumulates over a scan that can run
// for an hour. Past the cap, identical short messages stop being separable and
// say so in a warning rather than being silently merged.
const MAX_DUPLICATE_BUCKETS = 50_000;

// The thread id the current scan writes under. It is resolved once by the
// background worker, which knows the thread's aliases, and is not the id in the
// URL when the same conversation was first captured under a different handle.
export type ThreadScanState = {
  canonicalThreadId: string | null;
};

export function createThreadScanState(): ThreadScanState {
  return { canonicalThreadId: null };
}

// The log itself does not scroll. The element that does is an ancestor, and
// which one cannot be known offline, so it is found by looking for the nearest
// ancestor that actually overflows.
export function resolveThreadScrollTarget(): ScrollTarget | null {
  const log = document.querySelector(SELECTORS.log);
  if (log === null) {
    return null;
  }

  for (let element = log; element.parentElement !== null; ) {
    if (element.scrollHeight > element.clientHeight + 1) {
      return createElementScrollTarget(element, 'up');
    }
    element = element.parentElement;
  }

  return null;
}

function isVirtualized(element: Element): boolean {
  return element.closest(SELECTORS.virtualizedPlaceholder) !== null;
}

export function createMessengerSiteAdapter(
  scanState: ThreadScanState,
): SiteAdapter<CapturedMessage, ScanOptions> {
  const duplicateIndex = new DuplicateMessageIndex(MAX_DUPLICATE_BUCKETS);
  let anchorsByMessage = new Map<Element, DateAnchor>();

  function resolveThreadId(): string {
    const fromUrl = resolveThreadTarget().threadId;
    return scanState.canonicalThreadId ?? fromUrl ?? 'unknown-thread';
  }

  return {
    resolvePageTarget: () => resolveThreadPageTarget(),

    resolveObservedRoot: () => document.querySelector(SELECTORS.log),

    findRenderedItemRoots: (root) => findMessageElements(root),

    findContainingItemRoot: (node) => {
      if (!(node instanceof Element)) {
        return null;
      }

      const row = node.closest(SELECTORS.messageRow);
      if (row === null || isVirtualized(row)) {
        return null;
      }

      return row;
    },

    isCapturableItemRoot: (element) =>
      element.isConnected && !isVirtualized(element),

    // Rebuilt per batch: scrolling upward parses a day's messages before the
    // separator that dates them is rendered, and the next batch is where the
    // anchor becomes available.
    beginBatch: () => {
      const log = document.querySelector(SELECTORS.log);
      anchorsByMessage =
        log === null
          ? new Map<Element, DateAnchor>()
          : buildDateAnchorIndex(log, new Date());
    },

    captureItem: async (itemRoot, collection, options, capturedAt) => {
      const parsed = parseMessage(itemRoot, new Date());
      const anchored = anchorMessageTimestamp(
        parsed.displayedAt,
        anchorsByMessage.get(itemRoot) ?? null,
      );
      const sentAt = anchored?.sentAt ?? parsed.sentAt;

      const threadId = resolveThreadId();
      const duplicateBucketIndex =
        parsed.messageId === null ? duplicateIndex.next(threadId, parsed) : 0;
      const identity = await resolveMessageIdentity(
        threadId,
        parsed,
        duplicateBucketIndex ?? 0,
      );

      const warnings: MessageWarning[] = [
        // An anchor supplies the real day, so the timestamp no longer depends on
        // when the capture ran.
        ...parsed.warnings.filter(
          (warning) => !(anchored !== null && warning === 'INFERRED_TIMESTAMP'),
        ),
        ...(sentAt === null ? (['UNRESOLVED_TIMESTAMP'] as const) : []),
        ...(identity.identitySource === 'contentHash'
          ? (['UNSTABLE_IDENTITY'] as const)
          : []),
        ...(duplicateBucketIndex === null
          ? (['DUPLICATE_INDEX_OVERFLOW'] as const)
          : []),
      ];

      return {
        ...identity,
        fingerprint: null,
        collection,
        threadId,
        messageId: parsed.messageId,
        sender: parsed.sender,
        displayedAt: parsed.displayedAt,
        sentAt,
        sortKey: buildSortKey(sentAt, capturedAt),
        text: parsed.text,
        isReply: parsed.isReply,
        isUnsent: false,
        reactions: options.captureReactions ? parsed.reactions : [],
        attachments: options.captureAttachments ? parsed.attachments : [],
        warnings: [...new Set(warnings)],
        capturedAt,
        updatedAt: capturedAt,
      };
    },

    retainIdentity: retainCapturedIdentity,
    isBetterCapture: isBetterCapturedMessage,
    resolveScrollTarget: resolveThreadScrollTarget,
    // Messenger renders a whole message without being asked, so there is nothing
    // to click. Keeping this empty is also what keeps a scan free of synthetic
    // clicks on the user's live session.
    expansions: [],
  };
}
