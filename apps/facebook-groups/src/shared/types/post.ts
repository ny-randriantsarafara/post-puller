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
  reactionCount: number | null;
  reactionBreakdown: ReactionBreakdown;
  commentCount: number | null;
  shareCount: number | null;
  comments: CapturedComment[];
  attachments: Attachment[];
  warnings: PostWarning[];
};

export type ParsedPostDraft = Omit<
  CapturedPost,
  'identityKey' | 'identitySource' | 'fingerprint' | 'capturedAt' | 'updatedAt'
>;
