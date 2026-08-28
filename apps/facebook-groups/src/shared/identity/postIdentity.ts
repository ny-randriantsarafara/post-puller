import { createContentHash } from './contentHash';
import { createPostFingerprint } from './postFingerprint';
import { extractPostIdFromElement, extractPostIdFromUrl, normalizePostUrl } from './postUrl';
import type { CapturedPost, IdentitySource, ParsedPostDraft } from '../types';

const IDENTITY_STRENGTH: Record<IdentitySource, number> = {
  contentHash: 0,
  postUrl: 1,
  postId: 2,
};

export type PostIdentity = {
  identityKey: string;
  identitySource: IdentitySource;
  postId: string | null;
  postUrl: string | null;
};

export function resolveAuthorLabel(author: ParsedPostDraft['author']): string {
  if (author.kind === 'named') {
    return author.name;
  }

  if (author.kind === 'anonymous') {
    return author.label;
  }

  return 'unknown-author';
}

export async function resolvePostIdentity(
  draft: ParsedPostDraft,
  postElement: Element | null,
): Promise<PostIdentity> {
  const normalizedUrl = normalizePostUrl(draft.postUrl);
  const postIdFromUrl = extractPostIdFromUrl(normalizedUrl);
  const postIdFromElement =
    postElement === null ? null : extractPostIdFromElement(postElement);
  const postId = postIdFromElement ?? postIdFromUrl ?? draft.postId;

  if (postId !== null) {
    return {
      identityKey: `postId:${postId}`,
      identitySource: 'postId',
      postId,
      postUrl: normalizedUrl,
    };
  }

  if (normalizedUrl !== null) {
    return {
      identityKey: `postUrl:${normalizedUrl}`,
      identitySource: 'postUrl',
      postId: null,
      postUrl: normalizedUrl,
    };
  }

  const contentHash = await createContentHash({
    authorLabel: resolveAuthorLabel(draft.author),
    text: draft.text,
    displayedDate: draft.displayedDate,
  });

  return {
    identityKey: `contentHash:${contentHash}`,
    identitySource: 'contentHash',
    postId: null,
    postUrl: null,
  };
}

export async function finalizeCapturedPost(
  draft: ParsedPostDraft,
  postElement: Element | null,
  capturedAt: string,
): Promise<CapturedPost> {
  const identity = await resolvePostIdentity(draft, postElement);
  const fingerprint = await createPostFingerprint({
    authorLabel: resolveAuthorLabel(draft.author),
    text: draft.text,
  });

  return {
    ...draft,
    ...identity,
    fingerprint,
    capturedAt,
    updatedAt: capturedAt,
  };
}

export function isStrongerIdentity(
  existingPost: CapturedPost,
  incomingPost: CapturedPost,
): boolean {
  return (
    IDENTITY_STRENGTH[incomingPost.identitySource] >
    IDENTITY_STRENGTH[existingPost.identitySource]
  );
}

// Two sightings that both carry a Facebook id or url and disagree on it are
// different posts, however alike their opening lines look. Merging them on a
// matching fingerprint would lose one of them.
export function contradictsStoredIdentity(
  existingPost: CapturedPost,
  incomingPost: CapturedPost,
): boolean {
  if (
    existingPost.postId !== null &&
    incomingPost.postId !== null &&
    existingPost.postId !== incomingPost.postId
  ) {
    return true;
  }

  return (
    existingPost.postUrl !== null &&
    incomingPost.postUrl !== null &&
    existingPost.postUrl !== incomingPost.postUrl
  );
}

// An emptied story hashes to the same key as every other emptied story, so
// storing one would silently overwrite an unrelated post under that key.
export function isIdentifiableCapturedPost(post: CapturedPost): boolean {
  if (post.identitySource !== 'contentHash') {
    return true;
  }

  if (post.author.kind !== 'unknown' || post.displayedDate !== null) {
    return true;
  }

  return post.text !== null && post.text.trim().length > 0;
}

export function retainCapturedIdentity(
  previousPost: CapturedPost,
  incomingPost: CapturedPost,
): CapturedPost {
  if (previousPost.identityKey === incomingPost.identityKey) {
    return incomingPost;
  }

  return {
    ...incomingPost,
    identityKey: previousPost.identityKey,
    identitySource: previousPost.identitySource,
  };
}
