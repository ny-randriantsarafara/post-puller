export type IdentitySource = 'contentHash' | 'externalUrl' | 'externalId';

// A sighting that carries a stronger identity takes the record's key over from
// a weaker one, so a post first stored under a content hash moves to its real
// id once the site finally exposes it.
export const IDENTITY_STRENGTH: Record<IdentitySource, number> = {
  contentHash: 0,
  externalUrl: 1,
  externalId: 2,
};

// identityKey is the IndexedDB primary key of a stored record, so its prefix is
// persisted data and cannot follow a rename of the field it was named after.
// Every domain states the prefixes its own records were written with.
export type IdentityKeyPrefixes = Record<IdentitySource, string>;

export function buildIdentityKey(
  prefixes: IdentityKeyPrefixes,
  source: IdentitySource,
  value: string,
): string {
  return `${prefixes[source]}:${value}`;
}

export function isStrongerIdentitySource(
  existing: IdentitySource,
  incoming: IdentitySource,
): boolean {
  return IDENTITY_STRENGTH[incoming] > IDENTITY_STRENGTH[existing];
}
