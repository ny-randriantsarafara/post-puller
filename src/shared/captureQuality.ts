import type { CapturedPost } from './types';

function textLength(text: string | null): number {
  return text?.length ?? 0;
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

  return existingPost.publishedAt === null && incomingPost.publishedAt !== null;
}
