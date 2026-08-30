// Case and accent folded, because a capture made in French is full of words a
// person will type without their accents. A search for "elodie" that does not
// find "Élodie" reads as broken rather than as precise.
export function foldSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export type SearchMatcher = (parts: readonly string[]) => boolean;

// Folds the query once and returns the test to run against every record, because
// a search walks the store and folding the query per record would be the most
// expensive part of it. An empty query matches everything, so a caller can hand
// the matcher a blank search box without branching around it.
export function createSearchMatcher(query: string): SearchMatcher {
  const foldedQuery = foldSearchText(query.trim());

  if (foldedQuery.length === 0) {
    return () => true;
  }

  return (parts) => parts.some((part) => foldSearchText(part).includes(foldedQuery));
}
