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
  // The index over a record's collection url. Removing one collection's records
  // without it means reading and deserialising every record in the store, which
  // is a full scan to answer a question about one conversation or one group.
  readonly collectionIndexName: string;
  // The multiEntry index over a record's warning codes. Counting how many stored
  // items carry one code is what turns a parser that quietly stopped reading a
  // field into a number, and the index answers it without deserialising a single
  // record. It cannot also carry the order the preview reads in: IndexedDB
  // refuses multiEntry on a compound key path, so a filtered listing walks the
  // ordered index instead and this index is only ever counted.
  readonly warningIndexName: string;
  // Every store a write may touch, not just the item store. A domain that keeps
  // a summary alongside its items has to update both in one transaction, or a
  // service worker dying mid-batch leaves the summary disagreeing with reality.
  readonly stores: readonly ObjectStoreConfig[];
  // Applied to every record of the item store when an existing database is
  // raised to a new version. Only a domain that added an indexed field needs it:
  // reading a field into shape is enough for an export, and not enough for an
  // index, which never sees the read.
  readonly backfillItem?: (value: unknown) => unknown;
};

export function listStoreNames(config: StorageConfig): string[] {
  return config.stores.map((store) => store.name);
}
