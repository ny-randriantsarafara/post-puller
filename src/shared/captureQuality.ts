import type { CapturedComment, CapturedPost } from './types';
import { sumReactionBreakdown } from './types/reactions';

function textLength(text: string | null): number {
  return text?.length ?? 0;
}

function commentKey(comment: CapturedComment): string {
  if (comment.commentId !== null) {
    return `id:${comment.commentId}`;
  }

  const authorLabel =
    comment.author.kind === 'named'
      ? comment.author.name
      : comment.author.kind === 'anonymous'
        ? comment.author.label
        : 'unknown-author';

  return `fallback:${authorLabel}:${comment.text?.slice(0, 60) ?? ''}`;
}

function hasMoreReactionDetail(
  existingComment: CapturedComment,
  incomingComment: CapturedComment,
): boolean {
  const existingTotal = sumReactionBreakdown(existingComment.reactionBreakdown);
  const incomingTotal = sumReactionBreakdown(incomingComment.reactionBreakdown);
  return incomingTotal > existingTotal;
}

function mergeCommentPair(
  existingComment: CapturedComment,
  incomingComment: CapturedComment,
): CapturedComment {
  const keepIncomingText =
    textLength(incomingComment.text) > textLength(existingComment.text);
  const keepIncomingReactions =
    hasMoreReactionDetail(existingComment, incomingComment) ||
    (existingComment.reactionCount === null && incomingComment.reactionCount !== null);
  const keepIncomingWarnings =
    incomingComment.warnings.length < existingComment.warnings.length;

  return {
    ...existingComment,
    ...incomingComment,
    text: keepIncomingText ? incomingComment.text : existingComment.text,
    reactionCount: keepIncomingReactions
      ? incomingComment.reactionCount
      : existingComment.reactionCount,
    reactionBreakdown: keepIncomingReactions
      ? incomingComment.reactionBreakdown
      : existingComment.reactionBreakdown,
    warnings: keepIncomingWarnings
      ? incomingComment.warnings
      : existingComment.warnings,
  };
}

export function mergeComments(
  existingComments: CapturedComment[],
  incomingComments: CapturedComment[],
): CapturedComment[] {
  const merged = new Map<string, CapturedComment>();

  for (const comment of existingComments) {
    merged.set(commentKey(comment), comment);
  }

  for (const incomingComment of incomingComments) {
    const key = commentKey(incomingComment);
    const existingComment = merged.get(key);
    if (existingComment === undefined) {
      merged.set(key, incomingComment);
      continue;
    }

    merged.set(key, mergeCommentPair(existingComment, incomingComment));
  }

  return [...merged.values()];
}

export function isBetterCapturedPost(
  existingPost: CapturedPost,
  incomingPost: CapturedPost,
): boolean {
  if (incomingPost.comments.length > existingPost.comments.length) {
    return true;
  }

  if (incomingPost.warnings.length < existingPost.warnings.length) {
    return true;
  }

  if (textLength(incomingPost.text) > textLength(existingPost.text)) {
    return true;
  }

  if (existingPost.postId === null && incomingPost.postId !== null) {
    return true;
  }

  if (existingPost.postUrl === null && incomingPost.postUrl !== null) {
    return true;
  }

  if (
    existingPost.reactionCount === null &&
    incomingPost.reactionCount !== null
  ) {
    return true;
  }

  if (
    sumReactionBreakdown(incomingPost.reactionBreakdown) >
    sumReactionBreakdown(existingPost.reactionBreakdown)
  ) {
    return true;
  }

  if (
    existingPost.commentCount === null &&
    incomingPost.commentCount !== null
  ) {
    return true;
  }

  if (existingPost.shareCount === null && incomingPost.shareCount !== null) {
    return true;
  }

  return existingPost.publishedAt === null && incomingPost.publishedAt !== null;
}
