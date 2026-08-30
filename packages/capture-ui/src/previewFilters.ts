// What a reader has narrowed the preview to. The date is not part of it: picking
// one moves the reader to where that day starts and then stops mattering, while
// these keep applying to every page that follows.
export type PreviewFilters = {
  readonly text: string;
  readonly warning: string | null;
  readonly pageSize: number;
};

// The page size changes how much is read, not what qualifies, so it is not a
// filter for the purposes of the two reads a preview can make: a page of
// everything stored, whose length is known, or a page of matches, which has to
// be walked to be counted.
export function hasActiveFilters(filters: PreviewFilters): boolean {
  return filters.text.trim().length > 0 || filters.warning !== null;
}
