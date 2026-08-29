import { judgeScanStats, type ScanStats } from '@extractor/capture-core/domain';

type ScanReadoutProps = {
  stats: ScanStats;
  // What the site calls the things it reads: messages, posts. Used in the
  // sentences below, which is why it is the plural.
  itemNoun: string;
};

// The counts are about the scan and not about the store, so they say "seen" and
// "read" rather than a total. A row read twice is two sightings of one item,
// which is why neither number is presented as a message count.
function resolveMessage(stats: ScanStats, itemNoun: string): string | null {
  const verdict = judgeScanStats(stats);
  const seenCount = String(stats.seenItemCount);
  const unreadCount = String(stats.unreadItemCount);

  switch (verdict) {
    case 'quiet':
    case 'reading':
      return null;
    case 'racing':
      return `${unreadCount} of the ${seenCount} ${itemNoun} seen were recycled by the page before they could be read. Capture is partial until they are seen again, so let the scan run another pass.`;
    case 'unreadable':
      return `None of the ${seenCount} ${itemNoun} seen could be read. That is what a changed layout looks like rather than an empty page, so treat this capture as incomplete.`;
    default: {
      const unhandled: never = verdict;
      return String(unhandled);
    }
  }
}

export function ScanReadout({ stats, itemNoun }: ScanReadoutProps) {
  if (stats.seenItemCount === 0) {
    return null;
  }

  const message = resolveMessage(stats, itemNoun);
  const readCount = stats.seenItemCount - stats.unreadItemCount;

  return (
    <div className="cui-readout">
      <p className="cui-readout__counts">
        This scan saw {stats.seenItemCount} {itemNoun} and read {readCount}.
      </p>
      {message !== null && (
        <p className="cui-message cui-message--warning">{message}</p>
      )}
    </div>
  );
}
