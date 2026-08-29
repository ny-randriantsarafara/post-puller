import type { CaptureDomain, StatsProjection } from '@extractor/capture-core/domain';
import { isBetterCapturedPost, mergeComments } from './captureQuality';
import {
  isIdentifiableCapturedPost,
  POST_IDENTITY_KEY_PREFIXES,
} from './identity/postIdentity';
import { capturedPostSchema, captureOptionsSchema } from './messaging/protocol';
import type { CapturedPost } from './types/post';
import type { CaptureOptions } from './types/captureOptions';
import { DEFAULT_CAPTURE_OPTIONS } from './types/captureOptions';

const GROUP_URL_PATTERN = /^https:\/\/(www\.)?facebook\.com\/groups\/[^/?#]+/;

export const COLLECTION_INDEX = 'by_collection';
export const CAPTURED_AT_INDEX = 'by_captured_at';
export const COLLECTION_CAPTURED_AT_INDEX = 'by_collection_captured_at';

export const POST_STATS_PROJECTION: StatsProjection<CapturedPost> = {
  countChildren: (post) => post.comments.length,
  readPublishedAt: (post) => post.publishedAt,
  isIncomplete: (post) => post.warnings.length > 0,
};

export const facebookGroupsDomain: CaptureDomain<CapturedPost, CaptureOptions> = {
  id: 'facebook-groups',
  itemSchema: capturedPostSchema,
  optionsSchema: captureOptionsSchema,
  defaultOptions: DEFAULT_CAPTURE_OPTIONS,
  storage: {
    databaseName: 'facebookGroupCapture',
    // Bumped for the rename to generic item fields. There is no upgrade work to
    // do: stored records are migrated as they are read, and identityKey, the
    // primary key, deliberately did not change.
    // Raised for the three indexes below. Records missing an indexed field are
    // left out of the index rather than failing the upgrade, so there is again
    // no upgrade work to do beyond declaring them.
    version: 4,
    itemStoreName: 'capturedPosts',
    collectionIndexName: COLLECTION_INDEX,
    stores: [
      {
        name: 'capturedPosts',
        keyPath: 'identityKey',
        indexes: [
          { name: 'by_fingerprint', keyPath: 'fingerprint' },
          { name: COLLECTION_INDEX, keyPath: 'collection.url' },
          // The preview reads newest first, across one group or all of them, and
          // pages through with a cursor rather than reading every post to show
          // twenty of them.
          { name: CAPTURED_AT_INDEX, keyPath: 'capturedAt' },
          {
            name: COLLECTION_CAPTURED_AT_INDEX,
            keyPath: ['collection.url', 'capturedAt'],
          },
        ],
      },
    ],
  },
  identityKeyPrefixes: POST_IDENTITY_KEY_PREFIXES,
  stats: POST_STATS_PROJECTION,
  isTargetUrl: (url) => GROUP_URL_PATTERN.test(url),
  isBetterCapture: isBetterCapturedPost,
  mergeCapture: (existingPost, incomingPost) => ({
    ...incomingPost,
    comments: mergeComments(existingPost.comments, incomingPost.comments),
  }),
  isIdentifiable: isIdentifiableCapturedPost,
};
