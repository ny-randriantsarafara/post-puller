import type { CapturedPost, GroupInfo } from '../types';
import {
  buildPublicationWindow,
  groupPostsByGroupUrl,
  type PublicationWindow,
} from '../stats/groupStats';

export const EXPORT_SCHEMA_VERSION = 2;

export type { PublicationWindow };

export type ExportEnvelope = {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  extensionVersion: string;
  exportedAt: string;
  group: GroupInfo;
  publicationWindow: PublicationWindow;
  stats: {
    postCount: number;
    commentCount: number;
    incompletePostCount: number;
  };
  posts: CapturedPost[];
};

export type GroupExportFile = {
  fileName: string;
  envelope: ExportEnvelope;
};

function slugifyGroupName(group: GroupInfo): string {
  const source =
    group.name !== null && group.name.trim().length > 0
      ? group.name
      : group.url.split('/').filter(Boolean).pop() ?? 'group';

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

function buildGroupExportFileName(
  group: GroupInfo,
  publicationWindow: PublicationWindow,
  exportedAt: string,
): string {
  const slug = slugifyGroupName(group);
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

export function buildGroupExportEnvelope(
  posts: CapturedPost[],
  group: GroupInfo,
  extensionVersion: string,
  exportedAt: string,
): ExportEnvelope {
  const publicationWindow = buildPublicationWindow(posts);

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    extensionVersion,
    exportedAt,
    group,
    publicationWindow,
    stats: buildStats(posts),
    posts,
  };
}

export function buildGroupExports(
  posts: CapturedPost[],
  extensionVersion: string,
  exportedAt: string,
): GroupExportFile[] {
  const postsByGroupUrl = groupPostsByGroupUrl(posts);

  return [...postsByGroupUrl.entries()].map(([groupUrl, groupPosts]) => {
    const group = groupPosts[0]?.group ?? { name: null, url: groupUrl };
    const envelope = buildGroupExportEnvelope(
      groupPosts,
      group,
      extensionVersion,
      exportedAt,
    );

    return {
      fileName: buildGroupExportFileName(group, envelope.publicationWindow, exportedAt),
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

export function downloadGroupExports(
  posts: CapturedPost[],
  extensionVersion: string,
  exportedAt: string,
): void {
  const exports = buildGroupExports(posts, extensionVersion, exportedAt);

  for (const groupExport of exports) {
    downloadExportEnvelope(groupExport.envelope, groupExport.fileName);
  }
}

// Kept for callers that still expect a single combined envelope during migration.
export function buildExportEnvelope(
  posts: CapturedPost[],
  extensionVersion: string,
  exportedAt: string,
): ExportEnvelope {
  const primaryGroup = posts[0]?.group ?? {
    name: null,
    url: 'https://www.facebook.com/groups/unknown',
  };

  return buildGroupExportEnvelope(posts, primaryGroup, extensionVersion, exportedAt);
}
