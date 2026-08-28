// How the core reads an item it knows nothing else about, so that counting and
// date windows stay site-agnostic. Children are comments for a group post and
// nothing at all for a message.
export type StatsProjection<TItem> = {
  countChildren: (item: TItem) => number;
  readPublishedAt: (item: TItem) => string | null;
  isIncomplete: (item: TItem) => boolean;
};
