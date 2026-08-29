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
    version: 3,
    itemStoreName: 'capturedPosts',
    stores: [
      {
        name: 'capturedPosts',
        keyPath: 'identityKey',
        indexes: [{ name: 'by_fingerprint', keyPath: 'fingerprint' }],
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
