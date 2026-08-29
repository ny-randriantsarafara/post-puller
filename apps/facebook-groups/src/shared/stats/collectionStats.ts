import type { CollectionCaptureStats } from '@extractor/capture-core/messaging';
import {
  buildCollectionStats as buildCollectionStatsFor,
  buildPublicationWindow as buildPublicationWindowFor,
  groupItemsByCollectionUrl,
} from '@extractor/capture-core/stats';
import type { PublicationWindow } from '@extractor/capture-core/messaging';
import { POST_STATS_PROJECTION } from '../domain';
import type { CapturedPost } from '../types/post';

export type {
  CollectionCaptureStats,
  PublicationWindow,
} from '@extractor/capture-core/messaging';
export type { CollectionStatsTotals } from '@extractor/capture-core/stats';
export {
  findCollectionStats,
  formatPublicationWindow,
  sumCollectionStats,
} from '@extractor/capture-core/stats';

export function groupPostsByCollectionUrl(
  posts: CapturedPost[],
): Map<string, CapturedPost[]> {
  return groupItemsByCollectionUrl(posts);
}

export function buildPublicationWindow(posts: CapturedPost[]): PublicationWindow {
  return buildPublicationWindowFor(posts, POST_STATS_PROJECTION);
}

export function buildCollectionStats(posts: CapturedPost[]): CollectionCaptureStats[] {
  return buildCollectionStatsFor(posts, POST_STATS_PROJECTION);
}
