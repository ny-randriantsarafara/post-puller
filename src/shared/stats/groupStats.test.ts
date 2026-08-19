import { describe, expect, it } from 'vitest';
import type { CapturedPost } from '../types';
import {
  buildGroupStats,
  buildPublicationWindow,
  findGroupStats,
  formatPublicationWindow,
  groupPostsByGroupUrl,
  sumGroupStats,
} from './groupStats';

function createSamplePost(
  groupUrl: string,
  groupName: string,
  overrides: Partial<CapturedPost> = {},
): CapturedPost {
  const capturedAt = overrides.capturedAt ?? '2026-08-19T12:00:00.000Z';

  return {
    identityKey: `postId:${groupUrl}-${String(Math.random())}`,
    identitySource: 'postId',
    fingerprint: null,
    postId: '1',
    postUrl: `${groupUrl}/posts/1/`,
    group: {
      name: groupName,
      url: groupUrl,
    },
    author: { kind: 'named', name: 'Jane Doe', profileUrl: null },
    text: 'Hello',
    displayedDate: '1 hour ago',
    publishedAt: '2026-08-19T11:00:00.000Z',
    reactionCount: 2,
    comments: [
      {
        author: { kind: 'named', name: 'John', profileUrl: null },
        text: 'Nice',
        displayedDate: '30 minutes ago',
        publishedAt: '2026-08-19T11:30:00.000Z',
        reactionCount: 1,
        warnings: [],
      },
    ],
    attachments: [{ kind: 'none' }],
    capturedAt,
    updatedAt: capturedAt,
    warnings: [],
    ...overrides,
  };
}

describe('groupStats', () => {
  it('groups posts by group url', () => {
    const posts = [
      createSamplePost('https://www.facebook.com/groups/a', 'Group A'),
      createSamplePost('https://www.facebook.com/groups/b', 'Group B'),
      createSamplePost('https://www.facebook.com/groups/a', 'Group A'),
    ];

    const groupedPosts = groupPostsByGroupUrl(posts);

    expect(groupedPosts.size).toBe(2);
    expect(groupedPosts.get('https://www.facebook.com/groups/a')).toHaveLength(2);
    expect(groupedPosts.get('https://www.facebook.com/groups/b')).toHaveLength(1);
  });

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
    const groupStats = buildGroupStats([
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

    expect(groupStats).toHaveLength(2);
    expect(groupStats[0]?.group.name).toBe('Group B');
    expect(groupStats[1]?.postCount).toBe(2);
    expect(groupStats[1]?.incompletePostCount).toBe(1);
    expect(groupStats[1]?.commentCount).toBe(2);
  });

  it('sums totals across groups', () => {
    const groupStats = buildGroupStats([
      createSamplePost('https://www.facebook.com/groups/a', 'Group A', {
        warnings: ['TRUNCATED_TEXT'],
      }),
      createSamplePost('https://www.facebook.com/groups/b', 'Group B'),
    ]);

    expect(sumGroupStats(groupStats)).toEqual({
      postCount: 2,
      incompletePostCount: 1,
      commentCount: 2,
    });
  });

  it('finds stats for a specific group url', () => {
    const groupStats = buildGroupStats([
      createSamplePost('https://www.facebook.com/groups/a', 'Group A'),
    ]);

    expect(findGroupStats(groupStats, 'https://www.facebook.com/groups/a')?.postCount).toBe(1);
    expect(findGroupStats(groupStats, 'https://www.facebook.com/groups/missing')).toBeNull();
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
