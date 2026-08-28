export type StorageConfig = {
  databaseName: string;
  version: number;
  itemStoreName: string;
  // Every store a write may touch, not just the item store. A domain that keeps
  // a summary alongside its items has to update both in one transaction, or a
  // service worker dying mid-batch leaves the summary disagreeing with reality.
  storeNames: readonly string[];
};
