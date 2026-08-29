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
