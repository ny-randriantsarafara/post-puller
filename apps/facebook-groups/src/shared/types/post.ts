import type { CapturedItemBase } from '@extractor/capture-core/domain';
import type { Attachment } from './attachment';
import type { PostAuthor } from './author';
import type { CapturedComment } from './comment';
import type { ReactionBreakdown } from './reactions';
import type { PostWarning } from './warnings';

export type CapturedPost = CapturedItemBase & {
  author: PostAuthor;
  text: string | null;
  displayedDate: string | null;
  publishedAt: string | null;
  // publishedAt is null for every post whose date could not be parsed, and
  // IndexedDB drops a record from an index when a key path component is null.
  // Indexing on sortKey instead keeps those posts enumerable in publication
  // order, which is precisely the set most worth finding again.
  sortKey: string;
  reactionCount: number | null;
  reactionBreakdown: ReactionBreakdown;
  commentCount: number | null;
  shareCount: number | null;
  comments: CapturedComment[];
  attachments: Attachment[];
  warnings: PostWarning[];
};

// The preview reads a group newest first, so an undated post belongs at the end
// of that read rather than at the head of every page. '!' sorts below every
// digit, which puts the whole undated group there and keeps it addressable as a
// range of its own.
export const UNDATED_SORT_KEY_PREFIX = '!';

export function buildPostSortKey(
  publishedAt: string | null,
  capturedAt: string,
): string {
  if (publishedAt === null) {
    return `${UNDATED_SORT_KEY_PREFIX}${capturedAt}`;
  }

  return publishedAt;
}

export type ParsedPostDraft = Omit<
  CapturedPost,
  | 'identityKey'
  | 'identitySource'
  | 'fingerprint'
  | 'sortKey'
  | 'capturedAt'
  | 'updatedAt'
>;
