export type StoreIndexConfig = {
  readonly name: string;
  readonly keyPath: string | readonly string[];
  // A multiEntry index over an array field gives one entry per element, which is
  // how a record is found under any one of several aliases.
  readonly multiEntry?: boolean;
  readonly unique?: boolean;
};

export type ObjectStoreConfig = {
  readonly name: string;
  readonly keyPath: string;
  readonly indexes: readonly StoreIndexConfig[];
};

export type StorageConfig = {
  readonly databaseName: string;
  readonly version: number;
  readonly itemStoreName: string;
  // Every store a write may touch, not just the item store. A domain that keeps
  // a summary alongside its items has to update both in one transaction, or a
  // service worker dying mid-batch leaves the summary disagreeing with reality.
  readonly stores: readonly ObjectStoreConfig[];
};

export function listStoreNames(config: StorageConfig): string[] {
  return config.stores.map((store) => store.name);
}
