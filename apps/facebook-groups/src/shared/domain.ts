import type { CaptureDomain, ItemProjection } from '@extractor/capture-core/domain';
import { isBetterCapturedPost, mergeComments } from './captureQuality';
import {
  isIdentifiableCapturedPost,
  POST_IDENTITY_KEY_PREFIXES,
} from './identity/postIdentity';
import { capturedPostSchema, captureOptionsSchema } from './messaging/protocol';
import type { PostAuthor } from './types/author';
import type { CapturedPost } from './types/post';
import type { CaptureOptions } from './types/captureOptions';
import { DEFAULT_CAPTURE_OPTIONS } from './types/captureOptions';

const GROUP_URL_PATTERN = /^https:\/\/(www\.)?facebook\.com\/groups\/[^/?#]+/;

export const COLLECTION_INDEX = 'by_collection';
export const CAPTURED_AT_INDEX = 'by_captured_at';
export const COLLECTION_CAPTURED_AT_INDEX = 'by_collection_captured_at';
export const SORT_KEY_INDEX = 'by_sort_key';
export const COLLECTION_SORT_KEY_INDEX = 'by_collection_sort_key';
export const WARNING_INDEX = 'by_warning';

// An author with no name contributes nothing to search. The placeholder the
// identity ladder uses for one would match every post by an unknown author on a
// search for the word unknown, which is not what anybody typing it means.
function readAuthorName(author: PostAuthor): string[] {
  if (author.kind === 'named') {
    return [author.name];
  }

  if (author.kind === 'anonymous') {
    return [author.label];
  }

  return [];
}

// Comments are searched with the post that holds them, so a group is searchable
// by what was said under a post and not only by what the post itself said.
function readSearchableParts(post: CapturedPost): string[] {
  const commentParts = post.comments.flatMap((comment) => [
    ...(comment.text === null ? [] : [comment.text]),
    ...readAuthorName(comment.author),
  ]);

  return [
    ...(post.text === null ? [] : [post.text]),
    ...readAuthorName(post.author),
    ...commentParts,
  ];
}

export const POST_PROJECTION: ItemProjection<CapturedPost> = {
  countChildren: (post) => post.comments.length,
  readPublishedAt: (post) => post.publishedAt,
  readWarnings: (post) => post.warnings,
  readSearchableText: readSearchableParts,
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
    // Raised again for publication order and the warning index. This one does
    // need upgrade work: sortKey is a field no stored record held, and an index
    // over it would find none of them. backfillItem below writes it in.
    version: 5,
    itemStoreName: 'capturedPosts',
    collectionIndexName: COLLECTION_INDEX,
    warningIndexName: WARNING_INDEX,
    // Parsing a stored record is what derives sortKey, so reading it through the
    // schema and writing the result back is the whole migration. A record the
    // schema rejects is left alone: it was already unreadable, and rewriting it
    // as something else would not make it readable.
    backfillItem: (value) => {
      const parsedPost = capturedPostSchema.safeParse(value);
      if (!parsedPost.success) {
        return value;
      }

      return parsedPost.data;
    },
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
          // When a post was published, rather than when it was captured. Two
          // scans a week apart read the same post in whichever order they ran,
          // and the question a reader asks of a group is almost always the other
          // one.
          { name: SORT_KEY_INDEX, keyPath: 'sortKey' },
          {
            name: COLLECTION_SORT_KEY_INDEX,
            keyPath: ['collection.url', 'sortKey'],
          },
          // One entry per warning a post carries, so how many posts lost their
          // author is a count over this index rather than a scan of the store.
          { name: WARNING_INDEX, keyPath: 'warnings', multiEntry: true },
        ],
      },
    ],
  },
  identityKeyPrefixes: POST_IDENTITY_KEY_PREFIXES,
  projection: POST_PROJECTION,
  isTargetUrl: (url) => GROUP_URL_PATTERN.test(url),
  isBetterCapture: isBetterCapturedPost,
  mergeCapture: (existingPost, incomingPost) => ({
    ...incomingPost,
    comments: mergeComments(existingPost.comments, incomingPost.comments),
  }),
  isIdentifiable: isIdentifiableCapturedPost,
};
