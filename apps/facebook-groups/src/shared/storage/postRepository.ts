import { createItemRepository } from '@extractor/capture-core/storage';
import { facebookGroupsDomain } from '../domain';
import type { CollectionCaptureStats } from '../stats/collectionStats';
import type { CapturedPost } from '../types';

const repository = createItemRepository(facebookGroupsDomain);

export type PostPage = {
  posts: CapturedPost[];
  total: number;
  offset: number;
  limit: number;
};

export const isBetterParse = repository.isBetterParse;

export function upsertPosts(posts: CapturedPost[]): Promise<number> {
  return repository.upsertItems(posts);
}

export function countPosts(): Promise<number> {
  return repository.countItems();
}

export function countIncompletePosts(): Promise<number> {
  return repository.countIncompleteItems();
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
  const page = await repository.listItemsPage(offset, limit, collectionUrl);

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
