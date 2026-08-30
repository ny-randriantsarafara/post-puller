import {
  resolveItemIdentity,
  type ResolvedIdentity,
} from '@extractor/capture-core/identity';
import type { IdentityKeyPrefixes } from '@extractor/capture-core/domain';
import { createPostFingerprint } from './postFingerprint';
import { extractPostIdFromElement, extractPostIdFromUrl, normalizePostUrl } from './postUrl';
import {
  buildPostSortKey,
  resolveAuthorLabel,
  type CapturedPost,
  type ParsedPostDraft,
} from '../types';

// These are the prefixes of primary keys already written to IndexedDB, so they
// stay on the old field names. Deriving them from externalId/externalUrl would
// make every re-seen post miss its record and, whenever the fingerprint is
// null, insert a duplicate rather than fail.
export const POST_IDENTITY_KEY_PREFIXES: IdentityKeyPrefixes = {
  externalId: 'postId',
  externalUrl: 'postUrl',
  contentHash: 'contentHash',
};

export type PostIdentity = ResolvedIdentity;

export {
  isStrongerIdentity,
  retainCapturedIdentity,
} from '@extractor/capture-core/identity';
export { contradictsStoredIdentity } from '@extractor/capture-core/storage';

export async function resolvePostIdentity(
  draft: ParsedPostDraft,
  postElement: Element | null,
): Promise<PostIdentity> {
  const normalizedUrl = normalizePostUrl(draft.externalUrl);
  const postIdFromUrl = extractPostIdFromUrl(normalizedUrl);
  const postIdFromElement =
    postElement === null ? null : extractPostIdFromElement(postElement);
  const postId = postIdFromElement ?? postIdFromUrl ?? draft.externalId;

  return resolveItemIdentity(POST_IDENTITY_KEY_PREFIXES, {
    externalId: postId,
    externalUrl: normalizedUrl,
    contentHashParts: [
      resolveAuthorLabel(draft.author),
      draft.text,
      draft.displayedDate,
    ],
  });
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
    sortKey: buildPostSortKey(draft.publishedAt, capturedAt),
    capturedAt,
    updatedAt: capturedAt,
  };
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
