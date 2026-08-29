import type { CaptureDomain, StatsProjection } from '@extractor/capture-core/domain';
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
export const ALIAS_INDEX = 'by_alias';

export const MESSAGE_STATS_PROJECTION: StatsProjection<CapturedMessage> = {
  // A message has no children. Reactions are the closest thing, and counting
  // them here is what makes the popup's aggregate figure mean something.
  countChildren: (message) => message.reactions.length,
  readPublishedAt: (message) => message.sentAt,
  isIncomplete: (message) => message.warnings.length > 0,
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
    version: 2,
    itemStoreName: MESSAGE_STORE_NAME,
    collectionIndexName: COLLECTION_INDEX,
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
  stats: MESSAGE_STATS_PROJECTION,
  isTargetUrl: (url) => THREAD_URL_PATTERN.test(url),
  isBetterCapture: isBetterCapturedMessage,
  mergeCapture: mergeCapturedMessage,
  isIdentifiable: isIdentifiableCapturedMessage,
};
