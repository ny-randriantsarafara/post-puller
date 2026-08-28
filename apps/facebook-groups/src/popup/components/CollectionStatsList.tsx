import {
  formatPublicationWindow,
  type CollectionCaptureStats,
} from '../../shared/stats/collectionStats';

type CollectionStatsListProps = {
  collectionStats: CollectionCaptureStats[];
  isBusy: boolean;
  onClearCollection: (collectionUrl: string, collectionName: string | null) => void;
};

function formatCollectionLabel(group: CollectionCaptureStats['collection']): string {
  if (group.name !== null && group.name.trim().length > 0) {
    return group.name;
  }

  const slug = group.url.split('/').filter(Boolean).pop();
  if (slug !== undefined) {
    return slug;
  }

  return 'Unknown group';
}

export function CollectionStatsList({
  collectionStats,
  isBusy,
  onClearCollection,
}: CollectionStatsListProps) {
  if (collectionStats.length === 0) {
    return null;
  }

  return (
    <section className="popup__group-stats">
      <h2 className="popup__group-stats-title">Stored by group</h2>
      <ul className="popup__group-stats-list">
        {collectionStats.map((collectionStat) => {
          const groupLabel = formatCollectionLabel(collectionStat.collection);

          return (
            <li className="popup__group-stats-item" key={collectionStat.collection.url}>
              <div className="popup__group-stats-summary">
                <span className="popup__group-stats-name">{groupLabel}</span>
                <span className="popup__group-stats-counts">
                  {collectionStat.postCount} posts · {collectionStat.incompletePostCount} incomplete ·{' '}
                  {formatPublicationWindow(collectionStat.publicationWindow)}
                </span>
              </div>
              <button
                type="button"
                className="button button--danger popup__group-stats-clear"
                disabled={isBusy}
                onClick={() => {
                  onClearCollection(collectionStat.collection.url, collectionStat.collection.name);
                }}
              >
                Clear
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
