import type { ReactionBreakdown } from './reactions';
import type { CommentWarning } from './warnings';

export type PostAuthor =
  | { kind: 'named'; name: string; profileUrl: string | null }
  | { kind: 'anonymous'; label: string }
  | { kind: 'unknown' };

export type Attachment =
  | { kind: 'image' | 'video' | 'link' | 'sharedPost'; url: string | null }
  | { kind: 'none' }
  | { kind: 'unknown' };

export type CapturedComment = {
  commentId: string | null;
  parentCommentId: string | null;
  depth: number;
  author: PostAuthor;
  text: string | null;
  displayedDate: string | null;
  publishedAt: string | null;
  reactionCount: number | null;
  reactionBreakdown: ReactionBreakdown;
  warnings: CommentWarning[];
};
