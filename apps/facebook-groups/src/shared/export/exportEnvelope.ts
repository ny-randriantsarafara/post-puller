import type { CollectionInfo } from '@extractor/capture-core/domain';
import type { CapturedPost } from '../types';
import type { PublicationWindow } from '../stats/collectionStats';

// Raised for sortKey, the publication-order key every post now carries, and for
// the switch to writing a file in publication order rather than capture order.
export const EXPORT_SCHEMA_VERSION = 5;

export type { PublicationWindow };

export type ExportEnvelope = {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  extensionVersion: string;
  exportedAt: string;
  collection: CollectionInfo;
  publicationWindow: PublicationWindow;
  stats: {
    postCount: number;
    commentCount: number;
    incompletePostCount: number;
  };
  posts: CapturedPost[];
};

// Everything a file says about itself, which is everything but the posts. Held
// apart from them so a group can be written a page at a time.
export type CollectionExportHeader = Omit<ExportEnvelope, 'posts'>;

// What the header needs from the posts, carried across pages so no page has to
// be kept.
export type CollectionExportSummary = {
  readonly postCount: number;
  readonly commentCount: number;
  readonly incompletePostCount: number;
  readonly publicationWindow: PublicationWindow;
};

export const EMPTY_COLLECTION_EXPORT_SUMMARY: CollectionExportSummary = {
  postCount: 0,
  commentCount: 0,
  incompletePostCount: 0,
  publicationWindow: { earliest: null, latest: null },
};

function slugifyCollectionName(collection: CollectionInfo): string {
  const source =
    collection.name !== null && collection.name.trim().length > 0
      ? collection.name
      : collection.url.split('/').filter(Boolean).pop() ?? 'group';

  const slug = source
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.length === 0 ? 'group' : slug;
}

function formatDateForFileName(isoDate: string): string {
  return isoDate.slice(0, 10);
}

export function buildCollectionExportFileName(
  collection: CollectionInfo,
  publicationWindow: PublicationWindow,
  exportedAt: string,
): string {
  const slug = slugifyCollectionName(collection);
  const exportDay = formatDateForFileName(exportedAt);

  if (
    publicationWindow.earliest !== null &&
    publicationWindow.latest !== null
  ) {
    const earliestDay = formatDateForFileName(publicationWindow.earliest);
    const latestDay = formatDateForFileName(publicationWindow.latest);
    return `${slug}_${earliestDay}_${latestDay}.json`;
  }

  return `${slug}_export-${exportDay}.json`;
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

function addPostToSummary(
  summary: CollectionExportSummary,
  post: CapturedPost,
): CollectionExportSummary {
  return {
    postCount: summary.postCount + 1,
    commentCount: summary.commentCount + post.comments.length,
    incompletePostCount: summary.incompletePostCount + Number(post.warnings.length > 0),
    publicationWindow: widenPublicationWindow(
      summary.publicationWindow,
      post.publishedAt,
    ),
  };
}

// Folded page by page while a file is written, so a group of any size costs one
// page of memory rather than all of it.
export function addPostsToCollectionExportSummary(
  summary: CollectionExportSummary,
  posts: readonly CapturedPost[],
): CollectionExportSummary {
  return posts.reduce(addPostToSummary, summary);
}

export function buildCollectionExportHeader(
  collection: CollectionInfo,
  summary: CollectionExportSummary,
  extensionVersion: string,
  exportedAt: string,
): CollectionExportHeader {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    extensionVersion,
    exportedAt,
    collection,
    publicationWindow: summary.publicationWindow,
    stats: {
      postCount: summary.postCount,
      commentCount: summary.commentCount,
      incompletePostCount: summary.incompletePostCount,
    },
  };
}

// The whole envelope in memory, for a caller that already holds every post. It
// shares the fold above, so the two cannot describe the same group differently.
export function buildCollectionExportEnvelope(
  posts: CapturedPost[],
  collection: CollectionInfo,
  extensionVersion: string,
  exportedAt: string,
): ExportEnvelope {
  const summary = addPostsToCollectionExportSummary(
    EMPTY_COLLECTION_EXPORT_SUMMARY,
    posts,
  );

  return {
    ...buildCollectionExportHeader(collection, summary, extensionVersion, exportedAt),
    posts,
  };
}


