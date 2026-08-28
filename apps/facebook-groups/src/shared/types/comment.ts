import type { PostAuthor } from './author';
import type { ReactionBreakdown } from './reactions';
import type { CommentWarning } from './warnings';

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
