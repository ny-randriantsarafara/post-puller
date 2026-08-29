import type { CollectionInfo } from '../domain/collection';
import type { CapturedItemBase } from '../domain/item';
import type { StatsProjection } from '../domain/stats';
import type {
  CollectionCaptureStats,
  PublicationWindow,
} from '../messaging/session';

export type CollectionStatsTotals = {
  itemCount: number;
  incompleteItemCount: number;
  childCount: number;
};

export function groupItemsByCollectionUrl<TItem extends CapturedItemBase>(
  items: TItem[],
): Map<string, TItem[]> {
  const itemsByCollectionUrl = new Map<string, TItem[]>();

  for (const item of items) {
    const existingItems = itemsByCollectionUrl.get(item.collection.url) ?? [];
    itemsByCollectionUrl.set(item.collection.url, [...existingItems, item]);
  }

  return itemsByCollectionUrl;
}

export function buildPublicationWindow<TItem extends CapturedItemBase>(
  items: TItem[],
  projection: StatsProjection<TItem>,
): PublicationWindow {
  const publishedDates = items
    .map((item) => projection.readPublishedAt(item))
    .filter((publishedAt): publishedAt is string => publishedAt !== null)
    .sort((left, right) => left.localeCompare(right));

  if (publishedDates.length === 0) {
    return {
      earliest: null,
      latest: null,
    };
  }

  return {
    earliest: publishedDates[0] ?? null,
    latest: publishedDates[publishedDates.length - 1] ?? null,
  };
}

function resolveCollectionInfo(
  collectionUrl: string,
  collectionItems: readonly CapturedItemBase[],
): CollectionInfo {
  const firstItem = collectionItems[0];
  if (firstItem === undefined) {
    return { name: null, url: collectionUrl };
  }

  return firstItem.collection;
}

function buildCollectionCaptureStats<TItem extends CapturedItemBase>(
  collectionUrl: string,
  collectionItems: TItem[],
  projection: StatsProjection<TItem>,
): CollectionCaptureStats {
  const childCount = collectionItems.reduce(
    (total, item) => total + projection.countChildren(item),
    0,
  );
  const incompleteItemCount = collectionItems.filter((item) =>
    projection.isIncomplete(item),
  ).length;
  const lastCapturedAt = collectionItems.reduce((latest, item) => {
    if (item.capturedAt > latest) {
      return item.capturedAt;
    }

    return latest;
  }, collectionItems[0]?.capturedAt ?? '');

  return {
    collection: resolveCollectionInfo(collectionUrl, collectionItems),
    itemCount: collectionItems.length,
    incompleteItemCount,
    childCount,
    publicationWindow: buildPublicationWindow(collectionItems, projection),
    lastCapturedAt,
  };
}

export function buildCollectionStats<TItem extends CapturedItemBase>(
  items: TItem[],
  projection: StatsProjection<TItem>,
): CollectionCaptureStats[] {
  const itemsByCollectionUrl = groupItemsByCollectionUrl(items);

  return [...itemsByCollectionUrl.entries()]
    .map(([collectionUrl, collectionItems]) =>
      buildCollectionCaptureStats(collectionUrl, collectionItems, projection),
    )
    .sort((left, right) => right.lastCapturedAt.localeCompare(left.lastCapturedAt));
}

// What one written record changed about its collection's totals. Produced where
// the write happens, because that is the only place that holds both the record
// that was there and the one that replaced it: a re-sighting of a message
// already stored adds no item but can turn an incomplete one complete.
export type CollectionStatsDelta = {
  readonly collection: CollectionInfo;
  readonly itemCount: number;
  readonly incompleteItemCount: number;
  readonly childCount: number;
  readonly publishedAt: string | null;
  readonly capturedAt: string;
};

export function buildCollectionStatsDelta<TItem extends CapturedItemBase>(
  existingItem: TItem | null,
  writtenItem: TItem,
  projection: StatsProjection<TItem>,
): CollectionStatsDelta {
  const wasIncomplete = existingItem !== null && projection.isIncomplete(existingItem);
  const previousChildCount =
    existingItem === null ? 0 : projection.countChildren(existingItem);

  return {
    collection: writtenItem.collection,
    itemCount: existingItem === null ? 1 : 0,
    incompleteItemCount:
      Number(projection.isIncomplete(writtenItem)) - Number(wasIncomplete),
    childCount: projection.countChildren(writtenItem) - previousChildCount,
    publishedAt: projection.readPublishedAt(writtenItem),
    capturedAt: writtenItem.capturedAt,
  };
}

function widenPublicationWindow(
  window: PublicationWindow,
  publishedAt: string | null,
): PublicationWindow {
  if (publishedAt === null) {
    return window;
  }

  return {
    earliest:
      window.earliest === null || publishedAt < window.earliest
        ? publishedAt
        : window.earliest,
    latest:
      window.latest === null || publishedAt > window.latest
        ? publishedAt
        : window.latest,
  };
}

const EMPTY_STATS: Omit<CollectionCaptureStats, 'collection' | 'lastCapturedAt'> = {
  itemCount: 0,
  incompleteItemCount: 0,
  childCount: 0,
  publicationWindow: { earliest: null, latest: null },
};

function addDelta(
  stats: CollectionCaptureStats | undefined,
  delta: CollectionStatsDelta,
): CollectionCaptureStats {
  const base = stats ?? {
    ...EMPTY_STATS,
    collection: delta.collection,
    lastCapturedAt: delta.capturedAt,
  };

  return {
    // The name can arrive later than the first record of a collection, so a
    // delta that carries one replaces a placeholder rather than being ignored.
    collection: delta.collection.name === null ? base.collection : delta.collection,
    itemCount: base.itemCount + delta.itemCount,
    incompleteItemCount: base.incompleteItemCount + delta.incompleteItemCount,
    childCount: base.childCount + delta.childCount,
    publicationWindow: widenPublicationWindow(
      base.publicationWindow,
      delta.publishedAt,
    ),
    lastCapturedAt:
      delta.capturedAt > base.lastCapturedAt ? delta.capturedAt : base.lastCapturedAt,
  };
}

// Applied to the totals a scan started from, so the popup moves with a batch
// without the store being read again. A full count is what the scan begins with
// and what a deletion goes back to.
export function applyCollectionStatsDeltas(
  collectionStats: readonly CollectionCaptureStats[],
  deltas: readonly CollectionStatsDelta[],
): CollectionCaptureStats[] {
  const statsByCollectionUrl = new Map(
    collectionStats.map((stats) => [stats.collection.url, stats]),
  );

  for (const delta of deltas) {
    statsByCollectionUrl.set(
      delta.collection.url,
      addDelta(statsByCollectionUrl.get(delta.collection.url), delta),
    );
  }

  return [...statsByCollectionUrl.values()].sort((left, right) =>
    right.lastCapturedAt.localeCompare(left.lastCapturedAt),
  );
}

export function sumCollectionStats(
  collectionStats: CollectionCaptureStats[],
): CollectionStatsTotals {
  return collectionStats.reduce(
    (totals, collectionStat) => ({
      itemCount: totals.itemCount + collectionStat.itemCount,
      incompleteItemCount:
        totals.incompleteItemCount + collectionStat.incompleteItemCount,
      childCount: totals.childCount + collectionStat.childCount,
    }),
    {
      itemCount: 0,
      incompleteItemCount: 0,
      childCount: 0,
    },
  );
}

export function findCollectionStats(
  collectionStats: CollectionCaptureStats[],
  collectionUrl: string | null,
): CollectionCaptureStats | null {
  if (collectionUrl === null) {
    return null;
  }

  return (
    collectionStats.find(
      (collectionStat) => collectionStat.collection.url === collectionUrl,
    ) ?? null
  );
}

export function formatPublicationWindow(publicationWindow: PublicationWindow): string {
  if (publicationWindow.earliest === null || publicationWindow.latest === null) {
    return 'No parsed dates';
  }

  const earliestDay = publicationWindow.earliest.slice(0, 10);
  const latestDay = publicationWindow.latest.slice(0, 10);

  if (earliestDay === latestDay) {
    return earliestDay;
  }

  return `${earliestDay} to ${latestDay}`;
}
