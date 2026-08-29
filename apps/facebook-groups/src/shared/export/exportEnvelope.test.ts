import { buildJsonRecordBlob } from '@extractor/capture-core/export';
import { readBlobText } from '@extractor/capture-core/testing/readBlobText';
import { describe, expect, it } from 'vitest';
import {
  addPostsToCollectionExportSummary,
  buildCollectionExportEnvelope,
  buildCollectionExportFileName,
  buildCollectionExportHeader,
  EMPTY_COLLECTION_EXPORT_SUMMARY,
  EXPORT_SCHEMA_VERSION,
} from './exportEnvelope';
import type { CapturedPost } from '../types';

const EXPORTED_AT = '2026-08-19T12:00:00.000Z';

const samplePost: CapturedPost = {
  identityKey: 'postId:1',
  identitySource: 'externalId',
  fingerprint: null,
  externalId: '1',
  externalUrl: 'https://www.facebook.com/groups/sample-group/posts/1/',
  collection: {
    name: 'Sample Group',
    url: 'https://www.facebook.com/groups/sample-group',
  },
  author: { kind: 'named', name: 'Jane Doe', profileUrl: null },
  text: 'Hello',
  displayedDate: '1 hour ago',
  publishedAt: '2026-08-19T11:00:00.000Z',
  reactionCount: 2,
  reactionBreakdown: { like: 2 },
  commentCount: 1,
  shareCount: null,
  comments: [
    {
      commentId: null,
      parentCommentId: null,
      depth: 0,
      author: { kind: 'named', name: 'John', profileUrl: null },
      text: 'Nice',
      displayedDate: '30 minutes ago',
      publishedAt: '2026-08-19T11:30:00.000Z',
      reactionCount: 1,
      reactionBreakdown: {},
      warnings: [],
    },
  ],
  attachments: [{ kind: 'none' }],
  capturedAt: '2026-08-19T12:00:00.000Z',
  updatedAt: '2026-08-19T12:00:00.000Z',
  warnings: ['MISSING_POST_URL'],
};

const secondGroupPost: CapturedPost = {
  ...samplePost,
  identityKey: 'postId:2',
  externalId: '2',
  externalUrl: 'https://www.facebook.com/groups/other-group/posts/2/',
  collection: {
    name: 'Other Group',
    url: 'https://www.facebook.com/groups/other-group',
  },
  publishedAt: '2026-08-10T08:00:00.000Z',
  capturedAt: '2026-08-19T12:00:00.000Z',
  updatedAt: '2026-08-19T12:00:00.000Z',
};

describe('buildCollectionExportEnvelope', () => {
  it('builds a versioned export envelope for one group', () => {
    const envelope = buildCollectionExportEnvelope(
      [samplePost],
      samplePost.collection,
      '0.1.0',
      '2026-08-19T12:00:00.000Z',
    );

    expect(envelope.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(envelope.extensionVersion).toBe('0.1.0');
    expect(envelope.collection).toEqual(samplePost.collection);
    expect(envelope.publicationWindow).toEqual({
      earliest: '2026-08-19T11:00:00.000Z',
      latest: '2026-08-19T11:00:00.000Z',
    });
    expect(envelope.stats.postCount).toBe(1);
    expect(envelope.stats.commentCount).toBe(1);
    expect(envelope.stats.incompletePostCount).toBe(1);
  });
});

// Named the way the download path names it: from the window the summary carried
// out of the posts, not from the posts themselves.
function exportFileName(posts: readonly CapturedPost[]): string {
  const summary = addPostsToCollectionExportSummary(
    EMPTY_COLLECTION_EXPORT_SUMMARY,
    posts,
  );
  const collection = posts[0]?.collection ?? { name: null, url: '' };

  return buildCollectionExportFileName(
    collection,
    summary.publicationWindow,
    EXPORTED_AT,
  );
}

describe('buildCollectionExportFileName', () => {
  it('names a file after the group and the window of its posts', () => {
    expect(exportFileName([samplePost])).toBe(
      'sample-group_2026-08-19_2026-08-19.json',
    );
    expect(exportFileName([secondGroupPost])).toBe(
      'other-group_2026-08-10_2026-08-10.json',
    );
  });

  it('falls back to export date when no publication dates exist', () => {
    const undatedPost: CapturedPost = {
      ...samplePost,
      displayedDate: null,
      publishedAt: null,
    };

    expect(exportFileName([undatedPost])).toBe('sample-group_export-2026-08-19.json');
  });
});

// The download path writes the header from a summary folded over pages and never
// holds the group, so the file it produces has to be the file the whole-envelope
// builder describes. A page size below the post count is the point: it is what
// makes the writer cross a page boundary.
describe('a file written a page at a time', () => {
  it('parses back to the envelope built from every post at once', async () => {
    const posts = [
      samplePost,
      { ...samplePost, identityKey: 'postId:3', externalId: '3', comments: [] },
    ];
    const summary = addPostsToCollectionExportSummary(
      EMPTY_COLLECTION_EXPORT_SUMMARY,
      posts,
    );

    const blob = await buildJsonRecordBlob({
      header: buildCollectionExportHeader(
        samplePost.collection,
        summary,
        '0.1.0',
        EXPORTED_AT,
      ),
      recordsKey: 'posts',
      readPage: (offset, limit) => Promise.resolve(posts.slice(offset, offset + limit)),
      pageSize: 1,
    });

    expect(JSON.parse(await readBlobText(blob))).toEqual(
      buildCollectionExportEnvelope(posts, samplePost.collection, '0.1.0', EXPORTED_AT),
    );
  });
});
