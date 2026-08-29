import type { CollectionStatsDelta } from '@extractor/capture-core/stats';
import {
  createItemRepository,
  type ItemPageOrder,
} from '@extractor/capture-core/storage';
import {
  CAPTURED_AT_INDEX,
  COLLECTION_CAPTURED_AT_INDEX,
  facebookGroupsDomain,
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

export const isBetterParse = repository.isBetterParse;

// Newest capture first, which is the order the preview reads in.
const NEWEST_FIRST: ItemPageOrder = {
  index: CAPTURED_AT_INDEX,
  collectionIndex: COLLECTION_CAPTURED_AT_INDEX,
  direction: 'prev',
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
  offset: number,
  limit: number,
  collectionUrl: string | null = null,
): Promise<PostPage> {
  const page = await repository.listItemsPage(
    NEWEST_FIRST,
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

export function clearPosts(): Promise<void> {
  return repository.clearItems();
}

export function clearCollectionPosts(collectionUrl: string): Promise<void> {
  return repository.clearCollectionItems(collectionUrl);
}
