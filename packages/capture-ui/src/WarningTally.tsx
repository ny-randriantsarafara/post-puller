// How many stored records carry each warning code. A single record with a
// warning is ordinary; the same warning on most of them is a parser that stopped
// reading a field, which is the failure a reader would otherwise only find by
// opening the export. Counted over everything stored rather than the page in
// front of the reader, for the same reason.
type WarningTallyProps = {
  warningCounts: ReadonlyMap<string, number>;
  caption: string;
};

// Enough to see which field is failing without turning the line into the whole
// vocabulary of the site.
const LISTED_WARNING_COUNT = 3;

export function WarningTally({ warningCounts, caption }: WarningTallyProps) {
  if (warningCounts.size === 0) {
    return null;
  }

  const rankedWarnings = [...warningCounts.entries()].sort(
    ([, leftCount], [, rightCount]) => rightCount - leftCount,
  );
  const listedWarnings = rankedWarnings.slice(0, LISTED_WARNING_COUNT);
  const remainingCount = rankedWarnings.length - listedWarnings.length;

  const listed = listedWarnings
    .map(([warning, count]) => `${warning} ${String(count)}`)
    .join(' · ');

  return (
    <p className="cui-tally">
      <span className="cui-tally__caption">{caption}</span> {listed}
      {remainingCount > 0 && ` · ${String(remainingCount)} more`}
    </p>
  );
}
