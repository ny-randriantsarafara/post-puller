import { describe, expect, it } from 'vitest';
import {
  buildCollectionExportEnvelope,
  buildCollectionExports,
  EXPORT_SCHEMA_VERSION,
} from './exportEnvelope';
import type { CapturedPost } from '../types';

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

describe('buildCollectionExports', () => {
  it('builds one file per group with a publication window file name', () => {
    const exports = buildCollectionExports(
      [samplePost, secondGroupPost],
      '0.1.0',
      '2026-08-19T12:00:00.000Z',
    );

    expect(exports).toHaveLength(2);
    expect(exports[0]?.fileName).toBe('sample-group_2026-08-19_2026-08-19.json');
    expect(exports[1]?.fileName).toBe('other-group_2026-08-10_2026-08-10.json');
    expect(exports[0]?.envelope.collection.url).toBe(
      'https://www.facebook.com/groups/sample-group',
    );
    expect(exports[1]?.envelope.collection.url).toBe(
      'https://www.facebook.com/groups/other-group',
    );
  });

  it('falls back to export date when no publication dates exist', () => {
    const undatedPost: CapturedPost = {
      ...samplePost,
      displayedDate: null,
      publishedAt: null,
    };

    const exports = buildCollectionExports(
      [undatedPost],
      '0.1.0',
      '2026-08-19T12:00:00.000Z',
    );

    expect(exports[0]?.fileName).toBe('sample-group_export-2026-08-19.json');
    expect(exports[0]?.envelope.publicationWindow).toEqual({
      earliest: null,
      latest: null,
    });
  });
});
