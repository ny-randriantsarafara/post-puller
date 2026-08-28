import type { CollectionInfo } from '@extractor/capture-core/domain';
import type { CapturedPost } from '../types';
import {
  buildPublicationWindow,
  groupPostsByCollectionUrl,
  type PublicationWindow,
} from '../stats/collectionStats';

export const EXPORT_SCHEMA_VERSION = 4;

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

export type CollectionExportFile = {
  fileName: string;
  envelope: ExportEnvelope;
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

function buildCollectionExportFileName(
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

function buildStats(posts: CapturedPost[]): ExportEnvelope['stats'] {
  const commentCount = posts.reduce(
    (total, post) => total + post.comments.length,
    0,
  );
  const incompletePostCount = posts.filter((post) => post.warnings.length > 0).length;

  return {
    postCount: posts.length,
    commentCount,
    incompletePostCount,
  };
}

export function buildCollectionExportEnvelope(
  posts: CapturedPost[],
  collection: CollectionInfo,
  extensionVersion: string,
  exportedAt: string,
): ExportEnvelope {
  const publicationWindow = buildPublicationWindow(posts);

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    extensionVersion,
    exportedAt,
    collection,
    publicationWindow,
    stats: buildStats(posts),
    posts,
  };
}

export function buildCollectionExports(
  posts: CapturedPost[],
  extensionVersion: string,
  exportedAt: string,
): CollectionExportFile[] {
  const postsByCollectionUrl = groupPostsByCollectionUrl(posts);

  return [...postsByCollectionUrl.entries()].map(([collectionUrl, collectionPosts]) => {
    const collection = collectionPosts[0]?.collection ?? { name: null, url: collectionUrl };
    const envelope = buildCollectionExportEnvelope(
      collectionPosts,
      collection,
      extensionVersion,
      exportedAt,
    );

    return {
      fileName: buildCollectionExportFileName(
        collection,
        envelope.publicationWindow,
        exportedAt,
      ),
      envelope,
    };
  });
}

export function serializeExportEnvelope(envelope: ExportEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export function downloadExportEnvelope(
  envelope: ExportEnvelope,
  fileName: string,
): void {
  const serialized = serializeExportEnvelope(envelope);
  const blob = new Blob([serialized], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

export function downloadCollectionExports(
  posts: CapturedPost[],
  extensionVersion: string,
  exportedAt: string,
): void {
  const exports = buildCollectionExports(posts, extensionVersion, exportedAt);

  for (const collectionExport of exports) {
    downloadExportEnvelope(collectionExport.envelope, collectionExport.fileName);
  }
}
