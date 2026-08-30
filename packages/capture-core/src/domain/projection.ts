// How the core reads an item it knows nothing else about, so that counting, date
// windows, warning indexing and text search all stay site-agnostic. Children are
// comments for a group post and nothing at all for a message.
export type ItemProjection<TItem> = {
  countChildren: (item: TItem) => number;
  readPublishedAt: (item: TItem) => string | null;
  // The codes a site recorded against this item. Incompleteness is derived from
  // it rather than reported separately, so an item cannot call itself complete
  // while carrying warnings the warning index will still find it under.
  readWarnings: (item: TItem) => readonly string[];
  // Every part of an item a person would search for, returned as parts rather
  // than one joined string so a match cannot straddle two of them: searching for
  // "Marie wrote" should not match an author named Marie beside a body that
  // opens with "wrote".
  readSearchableText: (item: TItem) => readonly string[];
};

export function isIncompleteItem<TItem>(
  projection: ItemProjection<TItem>,
  item: TItem,
): boolean {
  return projection.readWarnings(item).length > 0;
}
