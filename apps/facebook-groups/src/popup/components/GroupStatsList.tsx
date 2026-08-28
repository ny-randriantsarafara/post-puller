import {
  formatPublicationWindow,
  type GroupCaptureStats,
} from '../../shared/stats/groupStats';

type GroupStatsListProps = {
  groupStats: GroupCaptureStats[];
  isBusy: boolean;
  onClearGroup: (groupUrl: string, groupName: string | null) => void;
};

function formatGroupLabel(group: GroupCaptureStats['group']): string {
  if (group.name !== null && group.name.trim().length > 0) {
    return group.name;
  }

  const slug = group.url.split('/').filter(Boolean).pop();
  if (slug !== undefined) {
    return slug;
  }

  return 'Unknown group';
}

export function GroupStatsList({
  groupStats,
  isBusy,
  onClearGroup,
}: GroupStatsListProps) {
  if (groupStats.length === 0) {
    return null;
  }

  return (
    <section className="popup__group-stats">
      <h2 className="popup__group-stats-title">Stored by group</h2>
      <ul className="popup__group-stats-list">
        {groupStats.map((groupStat) => {
          const groupLabel = formatGroupLabel(groupStat.group);

          return (
            <li className="popup__group-stats-item" key={groupStat.group.url}>
              <div className="popup__group-stats-summary">
                <span className="popup__group-stats-name">{groupLabel}</span>
                <span className="popup__group-stats-counts">
                  {groupStat.postCount} posts · {groupStat.incompletePostCount} incomplete ·{' '}
                  {formatPublicationWindow(groupStat.publicationWindow)}
                </span>
              </div>
              <button
                type="button"
                className="button button--danger popup__group-stats-clear"
                disabled={isBusy}
                onClick={() => {
                  onClearGroup(groupStat.group.url, groupStat.group.name);
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
