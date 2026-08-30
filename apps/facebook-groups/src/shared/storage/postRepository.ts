import type { CollectionStatsDelta } from '@extractor/capture-core/stats';
import {
  createItemRepository,
  type ItemFilter,
  type ItemPageOrder,
} from '@extractor/capture-core/storage';
import {
  CAPTURED_AT_INDEX,
  COLLECTION_CAPTURED_AT_INDEX,
  COLLECTION_SORT_KEY_INDEX,
  facebookGroupsDomain,
  SORT_KEY_INDEX,
} from '../domain';
import type { CollectionCaptureStats } from '../stats/collectionStats';
import type { CapturedPost } from '../types';

export const postRepository = createItemRepository(facebookGroupsDomain);

const repository = postRepository;

export type PostPage = {
  posts: CapturedPost[];
  total: number;
  offset: number;
  limit: number;
};

// A filtered read knows whether more posts follow, not how many matched. See
// findPostsPage for why.
export type PostMatchPage = {
  posts: CapturedPost[];
  offset: number;
  limit: number;
  hasMore: boolean;
};

export const isBetterParse = repository.isBetterParse;

// When a post was published, and when it was captured. They are different
// questions and the second one is rarely the one being asked: two scans a week
// apart read the same feed in whichever order they happened to run.
export const POST_ORDERS = [
  'newestPublication',
  'oldestPublication',
  'newestCapture',
] as const;

export type PostOrderName = (typeof POST_ORDERS)[number];

const POST_ORDER_BY_NAME: Record<PostOrderName, ItemPageOrder> = {
  newestPublication: {
    index: SORT_KEY_INDEX,
    collectionIndex: COLLECTION_SORT_KEY_INDEX,
    direction: 'prev',
  },
  oldestPublication: {
    index: SORT_KEY_INDEX,
    collectionIndex: COLLECTION_SORT_KEY_INDEX,
    direction: 'next',
  },
  newestCapture: {
    index: CAPTURED_AT_INDEX,
    collectionIndex: COLLECTION_CAPTURED_AT_INDEX,
    direction: 'prev',
  },
};

export function upsertPosts(posts: CapturedPost[]): Promise<CollectionStatsDelta[]> {
  return repository.upsertItems(posts);
}

export function countPosts(): Promise<number> {
  return repository.countItems();
}

export function listAllPosts(): Promise<CapturedPost[]> {
  return repository.listAllItems();
}

export function listCollectionStats(): Promise<CollectionCaptureStats[]> {
  return repository.listCollectionStats();
}

export async function listPostsPage(
  orderName: PostOrderName,
  offset: number,
  limit: number,
  collectionUrl: string | null = null,
): Promise<PostPage> {
  const page = await repository.listItemsPage(
    POST_ORDER_BY_NAME[orderName],
    offset,
    limit,
    collectionUrl,
  );

  return {
    posts: page.items,
    total: page.total,
    offset: page.offset,
    limit: page.limit,
  };
}

// Narrowed by a warning code, a substring, or both. Neither can be asked of an
// index that is already ordering by publication date, so both are tested against
// the posts as that order is walked. That is why the page reports whether more
// follow instead of a total: counting every match means walking the whole group
// to show twenty of them.
export async function findPostsPage(
  orderName: PostOrderName,
  filter: ItemFilter,
  offset: number,
  limit: number,
  collectionUrl: string | null = null,
): Promise<PostMatchPage> {
  const page = await repository.findItemsPage(
    POST_ORDER_BY_NAME[orderName],
    filter,
    offset,
    limit,
    collectionUrl,
  );

  return {
    posts: page.items,
    offset: page.offset,
    limit: page.limit,
    hasMore: page.hasMore,
  };
}

export function countPostsByWarning(): Promise<ReadonlyMap<string, number>> {
  return repository.countItemsByWarning();
}

// Where a day begins for an order, which is not the same end of it in both
// directions: a newest-first read reaches a day from the instant after it, and
// an oldest-first read from the instant it started. A UTC day, like every instant
// in the store; a reader hours away from UTC lands hours into the day they asked
// for, which the page they land on absorbs.
function resolveDayBoundary(orderName: PostOrderName, isoDay: string): string {
  if (POST_ORDER_BY_NAME[orderName].direction === 'prev') {
    return `${isoDay}T23:59:59.999Z`;
  }

  return isoDay;
}

// How many posts the order puts ahead of a day, which is the offset a reader has
// to page to in order to land on it. Counted over an index range, so jumping to a
// month in a group of 100 000 posts costs no more than reading the page.
export function countPostsBeforeDay(
  orderName: PostOrderName,
  isoDay: string,
  collectionUrl: string | null = null,
): Promise<number> {
  return repository.countItemsBefore(
    POST_ORDER_BY_NAME[orderName],
    resolveDayBoundary(orderName, isoDay),
    collectionUrl,
  );
}

export function clearPosts(): Promise<void> {
  return repository.clearItems();
}

export function clearCollectionPosts(collectionUrl: string): Promise<void> {
  return repository.clearCollectionItems(collectionUrl);
}
