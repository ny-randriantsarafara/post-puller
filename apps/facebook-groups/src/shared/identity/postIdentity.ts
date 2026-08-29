import { createContentHash } from '@extractor/capture-core/identity';
import {
  buildIdentityKey,
  isStrongerIdentitySource,
  type IdentityKeyPrefixes,
  type IdentitySource,
} from '@extractor/capture-core/domain';
import { createPostFingerprint } from './postFingerprint';
import { extractPostIdFromElement, extractPostIdFromUrl, normalizePostUrl } from './postUrl';
import type { CapturedPost, ParsedPostDraft } from '../types';

// These are the prefixes of primary keys already written to IndexedDB, so they
// stay on the old field names. Deriving them from externalId/externalUrl would
// make every re-seen post miss its record and, whenever the fingerprint is
// null, insert a duplicate rather than fail.
export const POST_IDENTITY_KEY_PREFIXES: IdentityKeyPrefixes = {
  externalId: 'postId',
  externalUrl: 'postUrl',
  contentHash: 'contentHash',
};

export type PostIdentity = {
  identityKey: string;
  identitySource: IdentitySource;
  externalId: string | null;
  externalUrl: string | null;
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
  const normalizedUrl = normalizePostUrl(draft.externalUrl);
  const postIdFromUrl = extractPostIdFromUrl(normalizedUrl);
  const postIdFromElement =
    postElement === null ? null : extractPostIdFromElement(postElement);
  const postId = postIdFromElement ?? postIdFromUrl ?? draft.externalId;

  if (postId !== null) {
    return {
      identityKey: buildIdentityKey(POST_IDENTITY_KEY_PREFIXES, 'externalId', postId),
      identitySource: 'externalId',
      externalId: postId,
      externalUrl: normalizedUrl,
    };
  }

  if (normalizedUrl !== null) {
    return {
      identityKey: buildIdentityKey(
        POST_IDENTITY_KEY_PREFIXES,
        'externalUrl',
        normalizedUrl,
      ),
      identitySource: 'externalUrl',
      externalId: null,
      externalUrl: normalizedUrl,
    };
  }

  const contentHash = await createContentHash({
    authorLabel: resolveAuthorLabel(draft.author),
    text: draft.text,
    displayedDate: draft.displayedDate,
  });

  return {
    identityKey: buildIdentityKey(
      POST_IDENTITY_KEY_PREFIXES,
      'contentHash',
      contentHash,
    ),
    identitySource: 'contentHash',
    externalId: null,
    externalUrl: null,
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
  return isStrongerIdentitySource(
    existingPost.identitySource,
    incomingPost.identitySource,
  );
}

export { contradictsStoredIdentity } from '@extractor/capture-core/storage';

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
