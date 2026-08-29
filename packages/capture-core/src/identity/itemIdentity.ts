import {
  buildIdentityKey,
  isStrongerIdentitySource,
  type IdentityKeyPrefixes,
  type IdentitySource,
} from '../domain/identity';
import type { CapturedItemBase } from '../domain/item';
import { createContentHash } from './contentHash';

// What a domain extracts from the page before any identity is decided. The
// ladder below turns it into a key; the domain never builds one itself.
export type IdentityInput = {
  readonly externalId: string | null;
  readonly externalUrl: string | null;
  readonly contentHashParts: readonly (string | null)[];
};

export type ResolvedIdentity = {
  readonly identityKey: string;
  readonly identitySource: IdentitySource;
  readonly externalId: string | null;
  readonly externalUrl: string | null;
};

// The site's own id, then a permalink, then a hash of the content. Each rung
// down is less trustworthy, which is what lets a later sighting promote a
// record's key when the site finally exposes something better.
export async function resolveItemIdentity(
  prefixes: IdentityKeyPrefixes,
  input: IdentityInput,
): Promise<ResolvedIdentity> {
  if (input.externalId !== null) {
    return {
      identityKey: buildIdentityKey(prefixes, 'externalId', input.externalId),
      identitySource: 'externalId',
      externalId: input.externalId,
      externalUrl: input.externalUrl,
    };
  }

  if (input.externalUrl !== null) {
    return {
      identityKey: buildIdentityKey(prefixes, 'externalUrl', input.externalUrl),
      identitySource: 'externalUrl',
      externalId: null,
      externalUrl: input.externalUrl,
    };
  }

  const contentHash = await createContentHash(input.contentHashParts);

  return {
    identityKey: buildIdentityKey(prefixes, 'contentHash', contentHash),
    identitySource: 'contentHash',
    externalId: null,
    externalUrl: null,
  };
}

export function isStrongerIdentity(
  existingItem: CapturedItemBase,
  incomingItem: CapturedItemBase,
): boolean {
  return isStrongerIdentitySource(
    existingItem.identitySource,
    incomingItem.identitySource,
  );
}

// A re-parse that resolves a different key must not orphan the record already
// written under the previous one. The observer keeps the key it first stored,
// and only the repository is allowed to promote it.
export function retainCapturedIdentity<TItem extends CapturedItemBase>(
  previousItem: TItem,
  incomingItem: TItem,
): TItem {
  if (previousItem.identityKey === incomingItem.identityKey) {
    return incomingItem;
  }

  return {
    ...incomingItem,
    identityKey: previousItem.identityKey,
    identitySource: previousItem.identitySource,
  };
}
