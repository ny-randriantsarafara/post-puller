import { describe, expect, it } from 'vitest';
import { buildPostSortKey, type CapturedPost } from '../types';
import {
  buildCollectionStats,
  buildPublicationWindow,
  findCollectionStats,
  formatPublicationWindow,
  sumCollectionStats,
} from './collectionStats';

function createSamplePost(
  collectionUrl: string,
  collectionName: string,
  overrides: Partial<CapturedPost> = {},
): CapturedPost {
  const capturedAt = overrides.capturedAt ?? '2026-08-19T12:00:00.000Z';

  // Derived after the overrides rather than alongside the default date, so a
  // post overridden to be undated carries the sort key an undated post gets.
  const post: Omit<CapturedPost, 'sortKey'> = {
    identityKey: `postId:${collectionUrl}-${String(Math.random())}`,
    identitySource: 'externalId',
    fingerprint: null,
    externalId: '1',
    externalUrl: `${collectionUrl}/posts/1/`,
    collection: {
      name: collectionName,
      url: collectionUrl,
    },
    author: { kind: 'named', name: 'Jane Doe', profileUrl: null },
    text: 'Hello',
    displayedDate: '1 hour ago',
    publishedAt: '2026-08-19T11:00:00.000Z',
    reactionCount: 2,
    reactionBreakdown: {},
    commentCount: null,
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
    capturedAt,
    updatedAt: capturedAt,
    warnings: [],
    ...overrides,
  };

  return { ...post, sortKey: buildPostSortKey(post.publishedAt, post.capturedAt) };
}

describe('collectionStats', () => {
  it('builds publication windows from parsed dates only', () => {
    const posts = [
      createSamplePost('https://www.facebook.com/groups/a', 'Group A', {
        publishedAt: '2026-08-10T08:00:00.000Z',
      }),
      createSamplePost('https://www.facebook.com/groups/a', 'Group A', {
        publishedAt: null,
      }),
      createSamplePost('https://www.facebook.com/groups/a', 'Group A', {
        publishedAt: '2026-08-19T08:00:00.000Z',
      }),
    ];

    expect(buildPublicationWindow(posts)).toEqual({
      earliest: '2026-08-10T08:00:00.000Z',
      latest: '2026-08-19T08:00:00.000Z',
    });
  });

  it('returns no publication window when no post has a parsed date', () => {
    const posts = [
      createSamplePost('https://www.facebook.com/groups/a', 'Group A', {
        publishedAt: null,
      }),
    ];

    expect(buildPublicationWindow(posts)).toEqual({
      earliest: null,
      latest: null,
    });
  });

  it('builds per-group stats with incomplete counts and sorting by last capture', () => {
    const collectionStats = buildCollectionStats([
      createSamplePost('https://www.facebook.com/groups/a', 'Group A', {
        capturedAt: '2026-08-19T10:00:00.000Z',
        warnings: ['TRUNCATED_TEXT'],
      }),
      createSamplePost('https://www.facebook.com/groups/b', 'Group B', {
        capturedAt: '2026-08-19T12:00:00.000Z',
      }),
      createSamplePost('https://www.facebook.com/groups/a', 'Group A', {
        capturedAt: '2026-08-19T11:00:00.000Z',
      }),
    ]);

    expect(collectionStats).toHaveLength(2);
    expect(collectionStats[0]?.collection.name).toBe('Group B');
    expect(collectionStats[1]?.itemCount).toBe(2);
    expect(collectionStats[1]?.incompleteItemCount).toBe(1);
    expect(collectionStats[1]?.childCount).toBe(2);
  });

  it('sums totals across groups', () => {
    const collectionStats = buildCollectionStats([
      createSamplePost('https://www.facebook.com/groups/a', 'Group A', {
        warnings: ['TRUNCATED_TEXT'],
      }),
      createSamplePost('https://www.facebook.com/groups/b', 'Group B'),
    ]);

    expect(sumCollectionStats(collectionStats)).toEqual({
      itemCount: 2,
      incompleteItemCount: 1,
      childCount: 2,
    });
  });

  it('finds stats for a specific group url', () => {
    const collectionStats = buildCollectionStats([
      createSamplePost('https://www.facebook.com/groups/a', 'Group A'),
    ]);

    expect(findCollectionStats(collectionStats, 'https://www.facebook.com/groups/a')?.itemCount).toBe(1);
    expect(findCollectionStats(collectionStats, 'https://www.facebook.com/groups/missing')).toBeNull();
  });

  it('formats publication windows for display', () => {
    expect(
      formatPublicationWindow({
        earliest: '2026-08-05T08:00:00.000Z',
        latest: '2026-08-19T08:00:00.000Z',
      }),
    ).toBe('2026-08-05 to 2026-08-19');

    expect(
      formatPublicationWindow({
        earliest: '2026-08-19T08:00:00.000Z',
        latest: '2026-08-19T12:00:00.000Z',
      }),
    ).toBe('2026-08-19');

    expect(
      formatPublicationWindow({
        earliest: null,
        latest: null,
      }),
    ).toBe('No parsed dates');
  });
});
