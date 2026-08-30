import type { CaptureDomain, ItemProjection } from '@extractor/capture-core/domain';
import {
  isBetterCapturedMessage,
  isIdentifiableCapturedMessage,
  mergeCapturedMessage,
} from './captureQuality';
import { MESSAGE_IDENTITY_KEY_PREFIXES } from './identity/messageIdentity';
import { capturedMessageSchema, scanOptionsSchema } from './messaging/protocol';
import type { CapturedMessage } from './types/capturedMessage';
import type { ScanOptions } from './types/scanOptions';
import { DEFAULT_SCAN_OPTIONS } from './types/scanOptions';

const THREAD_URL_PATTERN =
  /^https:\/\/(www\.)?(messenger\.com|facebook\.com)\/(messages\/)?(e2ee\/)?t\//;

export const MESSAGE_STORE_NAME = 'capturedMessages';
export const THREAD_STORE_NAME = 'capturedThreads';

export const THREAD_SORT_INDEX = 'by_thread_sort';
export const THREAD_INDEX = 'by_thread';
export const COLLECTION_INDEX = 'by_collection';
export const WARNING_INDEX = 'by_warning';
export const ALIAS_INDEX = 'by_alias';

// The sender of a message the reader sent has no name in the DOM, so searching
// for your own name finds nothing. Leaving it out is better than folding the
// word Messenger happens to label you with into the searchable text of every
// message you ever sent.
function readSearchableParts(message: CapturedMessage): string[] {
  const senderName =
    message.sender !== null && message.sender.kind === 'other'
      ? [message.sender.name]
      : [];
  const attachmentCaptions = message.attachments.flatMap((attachment) =>
    attachment.kind === 'file' ? [attachment.caption] : [],
  );

  return [...(message.text === null ? [] : [message.text]), ...senderName, ...attachmentCaptions];
}

export const MESSAGE_PROJECTION: ItemProjection<CapturedMessage> = {
  // A message has no children. Reactions are the closest thing, and counting
  // them here is what makes the popup's aggregate figure mean something.
  countChildren: (message) => message.reactions.length,
  readPublishedAt: (message) => message.sentAt,
  readWarnings: (message) => message.warnings,
  readSearchableText: readSearchableParts,
};

export const messengerDomain: CaptureDomain<CapturedMessage, ScanOptions> = {
  id: 'messenger',
  itemSchema: capturedMessageSchema,
  optionsSchema: scanOptionsSchema,
  defaultOptions: DEFAULT_SCAN_OPTIONS,
  storage: {
    databaseName: 'messengerCapture',
    // Raised for by_collection, which the generic layer needs to remove one
    // conversation's messages without reading the store.
    // Raised again for by_warning. Declaring an index is the whole upgrade:
    // IndexedDB fills a new one from the records already stored, and a record
    // with no warnings simply has no entry in it.
    version: 3,
    itemStoreName: MESSAGE_STORE_NAME,
    collectionIndexName: COLLECTION_INDEX,
    warningIndexName: WARNING_INDEX,
    stores: [
      {
        name: MESSAGE_STORE_NAME,
        keyPath: 'identityKey',
        indexes: [
          { name: THREAD_INDEX, keyPath: 'threadId' },
          // Paging a thread in date order without deserialising the records
          // that are skipped, which a thread of 100 000 messages needs.
          { name: THREAD_SORT_INDEX, keyPath: ['threadId', 'sortKey'] },
          { name: COLLECTION_INDEX, keyPath: 'collection.url' },
          // One entry per warning a message carries, so how many messages lost
          // their sender is a count over this index rather than a scan.
          { name: WARNING_INDEX, keyPath: 'warnings', multiEntry: true },
          { name: 'by_fingerprint', keyPath: 'fingerprint' },
        ],
      },
      {
        name: THREAD_STORE_NAME,
        keyPath: 'threadId',
        indexes: [
          { name: 'by_last_scanned', keyPath: 'lastScannedAt' },
          { name: ALIAS_INDEX, keyPath: 'aliases', multiEntry: true },
        ],
      },
    ],
  },
  identityKeyPrefixes: MESSAGE_IDENTITY_KEY_PREFIXES,
  projection: MESSAGE_PROJECTION,
  isTargetUrl: (url) => THREAD_URL_PATTERN.test(url),
  isBetterCapture: isBetterCapturedMessage,
  mergeCapture: mergeCapturedMessage,
  isIdentifiable: isIdentifiableCapturedMessage,
};
