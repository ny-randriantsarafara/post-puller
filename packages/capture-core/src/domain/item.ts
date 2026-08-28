import type { CollectionInfo } from './collection';
import type { IdentitySource } from './identity';

// The fields the core needs to store, deduplicate and group an item. Everything
// a site actually captures lives in the domain's own item type on top of this.
export type CapturedItemBase = {
  identityKey: string;
  identitySource: IdentitySource;
  // Stable across re-sightings of the same item, unlike identityKey, which
  // changes when the site reveals more text or ages a relative date label.
  fingerprint: string | null;
  externalId: string | null;
  externalUrl: string | null;
  collection: CollectionInfo;
  capturedAt: string;
  updatedAt: string;
};
