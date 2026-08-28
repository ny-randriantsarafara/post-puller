// What a captured item belongs to: a Facebook group, a Messenger thread, and
// whatever a later adapter captures. Grouping, stats and export all key on url.
export type CollectionInfo = {
  name: string | null;
  url: string;
};
