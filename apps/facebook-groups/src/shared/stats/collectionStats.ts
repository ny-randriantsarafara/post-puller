import type { CollectionInfo } from '@extractor/capture-core/domain';
import type {
  CollectionCaptureStats,
  PublicationWindow,
} from '@extractor/capture-core/messaging';
import type { CapturedPost } from '../types/post';

export type {
  CollectionCaptureStats,
  PublicationWindow,
} from '@extractor/capture-core/messaging';

export type CollectionStatsTotals = {
  itemCount: number;
  incompleteItemCount: number;
  childCount: number;
};

export function groupPostsByCollectionUrl(
  posts: CapturedPost[],
): Map<string, CapturedPost[]> {
  const postsByCollectionUrl = new Map<string, CapturedPost[]>();

  for (const post of posts) {
    const existingPosts = postsByCollectionUrl.get(post.collection.url) ?? [];
    postsByCollectionUrl.set(post.collection.url, [...existingPosts, post]);
  }

  return postsByCollectionUrl;
}

export function buildPublicationWindow(posts: CapturedPost[]): PublicationWindow {
  const publishedDates = posts
    .map((post) => post.publishedAt)
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
  collectionPosts: CapturedPost[],
): CollectionInfo {
  const firstPost = collectionPosts[0];
  if (firstPost === undefined) {
    return { name: null, url: collectionUrl };
  }

  return firstPost.collection;
}

function buildCollectionCaptureStats(
  collectionUrl: string,
  collectionPosts: CapturedPost[],
): CollectionCaptureStats {
  const childCount = collectionPosts.reduce(
    (total, post) => total + post.comments.length,
    0,
  );
  const incompleteItemCount = collectionPosts.filter(
    (post) => post.warnings.length > 0,
  ).length;
  const lastCapturedAt = collectionPosts.reduce((latest, post) => {
    if (post.capturedAt > latest) {
      return post.capturedAt;
    }

    return latest;
  }, collectionPosts[0]?.capturedAt ?? '');

  return {
    collection: resolveCollectionInfo(collectionUrl, collectionPosts),
    itemCount: collectionPosts.length,
    incompleteItemCount,
    childCount,
    publicationWindow: buildPublicationWindow(collectionPosts),
    lastCapturedAt,
  };
}

export function buildCollectionStats(posts: CapturedPost[]): CollectionCaptureStats[] {
  const postsByCollectionUrl = groupPostsByCollectionUrl(posts);

  return [...postsByCollectionUrl.entries()]
    .map(([collectionUrl, collectionPosts]) =>
      buildCollectionCaptureStats(collectionUrl, collectionPosts),
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
