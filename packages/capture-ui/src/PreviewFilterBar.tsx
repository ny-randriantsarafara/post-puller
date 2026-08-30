import { hasActiveFilters, type PreviewFilters } from './previewFilters';

type PreviewFilterBarProps = {
  filters: PreviewFilters;
  // The codes the store actually holds, with how many records carry each. Offered
  // instead of the site's whole warning vocabulary, because a code no record
  // carries is not a filter anybody wants to pick.
  warningCounts: ReadonlyMap<string, number>;
  pageSizeOptions: readonly number[];
  searchPlaceholder: string;
  jumpDay: string;
  // A jump moves the reader to a position counted over everything stored, and a
  // filtered read is positioned by how many matches were passed instead. The two
  // are not the same number, so the control says so rather than landing the
  // reader somewhere that looks arbitrary.
  isJumpDisabled: boolean;
  onFiltersChange: (filters: PreviewFilters) => void;
  onJumpToDay: (day: string) => void;
};

const ANY_WARNING = 'any';

// Worst first, so the code most worth looking at is the one nearest the top of
// the list. The counts themselves are not shown here: they are counted over
// everything stored, while the list they would sit above is narrowed to one
// collection, and a number that does not match the rows under it is worse than
// no number at all.
function sortWarningsByCount(
  warningCounts: ReadonlyMap<string, number>,
): [string, number][] {
  return [...warningCounts.entries()].sort(
    ([leftWarning, leftCount], [rightWarning, rightCount]) => {
      if (leftCount === rightCount) {
        return leftWarning.localeCompare(rightWarning);
      }

      return rightCount - leftCount;
    },
  );
}

export function PreviewFilterBar({
  filters,
  warningCounts,
  pageSizeOptions,
  searchPlaceholder,
  jumpDay,
  isJumpDisabled,
  onFiltersChange,
  onJumpToDay,
}: PreviewFilterBarProps) {
  const sortedWarnings = sortWarningsByCount(warningCounts);

  return (
    <div className="cui-filters">
      <label className="cui-filter cui-filter--grow">
        <span className="cui-filter__label">Search</span>
        <input
          type="search"
          value={filters.text}
          placeholder={searchPlaceholder}
          onChange={(event) => {
            onFiltersChange({ ...filters, text: event.target.value });
          }}
        />
      </label>

      <label className="cui-filter">
        <span className="cui-filter__label">Problem</span>
        <select
          value={filters.warning ?? ANY_WARNING}
          disabled={sortedWarnings.length === 0}
          onChange={(event) => {
            const warning = event.target.value;
            onFiltersChange({
              ...filters,
              warning: warning === ANY_WARNING ? null : warning,
            });
          }}
        >
          <option value={ANY_WARNING}>Any</option>
          {sortedWarnings.map(([warning]) => (
            <option key={warning} value={warning}>
              {warning}
            </option>
          ))}
        </select>
      </label>

      <label className="cui-filter">
        <span className="cui-filter__label">
          {isJumpDisabled ? 'Jump to (clear filters first)' : 'Jump to'}
        </span>
        <input
          type="date"
          value={jumpDay}
          disabled={isJumpDisabled}
          onChange={(event) => {
            onJumpToDay(event.target.value);
          }}
        />
      </label>

      <label className="cui-filter">
        <span className="cui-filter__label">Per page</span>
        <select
          value={String(filters.pageSize)}
          onChange={(event) => {
            onFiltersChange({ ...filters, pageSize: Number(event.target.value) });
          }}
        >
          {pageSizeOptions.map((pageSize) => (
            <option key={pageSize} value={String(pageSize)}>
              {pageSize}
            </option>
          ))}
        </select>
      </label>

      {hasActiveFilters(filters) && (
        <button
          type="button"
          className="cui-button cui-button--secondary"
          onClick={() => {
            onFiltersChange({ ...filters, text: '', warning: null });
          }}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
