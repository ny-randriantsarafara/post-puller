import { describe, expect, it } from 'vitest';
import {
  clearCollectionPosts,
  clearPosts,
  countPosts,
  countPostsBeforeDay,
  countPostsByWarning,
  findPostsPage,
  isBetterParse,
  listAllPosts,
  listCollectionStats,
  listPostsPage,
  upsertPosts,
} from './postRepository';
import { buildPostSortKey, type CapturedPost } from '../types';

function createSamplePost(index: number, warnings: CapturedPost['warnings'] = []): CapturedPost {
  const identity = String(index);
  const capturedAt = new Date(2026, 7, 19, 12, 0, index).toISOString();

  return {
    identityKey: `postId:${identity}`,
    identitySource: 'externalId',
    fingerprint: null,
    externalId: identity,
    externalUrl: `https://www.facebook.com/groups/sample-group/permalink/${identity}`,
    collection: {
      name: 'Sample Group',
      url: 'https://www.facebook.com/groups/sample-group',
    },
    author: { kind: 'named', name: `Author ${identity}`, profileUrl: null },
    text: `Post ${identity}`,
    displayedDate: '1 hour ago',
    publishedAt: capturedAt,
    sortKey: buildPostSortKey(capturedAt, capturedAt),
    reactionCount: 1,
    reactionBreakdown: {},
    commentCount: null,
    shareCount: null,
    comments: [],
    attachments: [{ kind: 'none' }],
    capturedAt,
    updatedAt: capturedAt,
    warnings,
  };
}

// Published on a given day, captured on another, which is the case the two
// orders disagree about.
function createPostPublishedOn(index: number, publishedAt: string | null): CapturedPost {
  const post = createSamplePost(index);

  return {
    ...post,
    publishedAt,
    sortKey: buildPostSortKey(publishedAt, post.capturedAt),
  };
}

const LONG_TEXT =
  'Looking for a freelance developer to help with a small React project this month';

// A post with no Facebook id is keyed on a hash of content that Facebook changes
// between two sightings, which is exactly what the fingerprint absorbs.
function createHashIdentityPost(overrides: Partial<CapturedPost>): CapturedPost {
  return {
    ...createSamplePost(1),
    identityKey: 'contentHash:first-sighting',
    identitySource: 'contentHash',
    fingerprint: 'fingerprint-of-the-opening-line',
    externalId: null,
    externalUrl: null,
    text: `${LONG_TEXT.slice(0, 62)}…`,
    displayedDate: '1 hour ago',
    ...overrides,
  };
}

describe('postRepository', () => {
  it('deduplicates posts by identity key', async () => {
    await clearPosts();
    const post = createSamplePost(1);

    await upsertPosts([post]);
    await upsertPosts([post]);

    expect(await countPosts()).toBe(1);
  });

  it('replaces a post when the incoming parse is better', async () => {
    await clearPosts();
    const original = createSamplePost(2, ['MISSING_REACTION_COUNT']);
    const improved = {
      ...original,
      reactionCount: 4,
      warnings: [],
      updatedAt: new Date().toISOString(),
    };

    await upsertPosts([original]);
    await upsertPosts([improved]);

    const storedPosts = await listAllPosts();
    expect(storedPosts).toHaveLength(1);
    expect(storedPosts[0]?.reactionCount).toBe(4);
    expect(storedPosts[0]?.warnings).toEqual([]);
  });

  it('handles at least 500 posts in one session', async () => {
    await clearPosts();

    const posts = Array.from({ length: 500 }, (_, index) => createSamplePost(index + 1));
    for (let index = 0; index < posts.length; index += 50) {
      await upsertPosts(posts.slice(index, index + 50));
    }

    await upsertPosts(posts);

    expect(await countPosts()).toBe(500);
  });

  it('refuses records that carry no identity material, so they cannot overwrite a post', async () => {
    await clearPosts();
    const emptyStoryKey =
      'contentHash:b399feb705289ef2e943e590f7e8dcb975d7a79672756c153d2e448d536cd15a';
    const emptyStory: CapturedPost = {
      ...createSamplePost(6),
      identityKey: emptyStoryKey,
      identitySource: 'contentHash',
      externalId: null,
      externalUrl: null,
      author: { kind: 'unknown' },
      text: null,
      displayedDate: null,
    };

    await upsertPosts([createSamplePost(7)]);
    await upsertPosts([emptyStory, { ...emptyStory, reactionCount: 99 }]);

    const storedPosts = await listAllPosts();
    expect(storedPosts).toHaveLength(1);
    expect(storedPosts[0]?.externalId).toBe('7');
  });

  it('recognises a post whose date label and text changed between two sightings', async () => {
    await clearPosts();
    const firstSighting = createHashIdentityPost({});
    const secondSighting = createHashIdentityPost({
      identityKey: 'contentHash:second-sighting',
      text: LONG_TEXT,
      displayedDate: '2 hours ago',
      updatedAt: new Date().toISOString(),
    });

    await upsertPosts([firstSighting]);
    await upsertPosts([secondSighting]);

    const storedPosts = await listAllPosts();
    expect(storedPosts).toHaveLength(1);
    expect(storedPosts[0]?.text).toBe(LONG_TEXT);
    expect(storedPosts[0]?.identityKey).toBe('contentHash:first-sighting');
  });

  it('collapses two sightings of one post that arrive in the same batch', async () => {
    await clearPosts();

    await upsertPosts([
      createHashIdentityPost({}),
      createHashIdentityPost({
        identityKey: 'contentHash:second-sighting',
        text: LONG_TEXT,
      }),
    ]);

    expect(await countPosts()).toBe(1);
  });

  it('moves a post to its Facebook id once a later sighting exposes one', async () => {
    await clearPosts();

    await upsertPosts([createHashIdentityPost({})]);
    await upsertPosts([
      createHashIdentityPost({
        identityKey: 'postId:2001',
        identitySource: 'externalId',
        externalId: '2001',
        externalUrl: 'https://www.facebook.com/groups/sample-group/posts/2001/',
      }),
    ]);

    const storedPosts = await listAllPosts();
    expect(storedPosts).toHaveLength(1);
    expect(storedPosts[0]?.identityKey).toBe('postId:2001');
    expect(storedPosts[0]?.identitySource).toBe('externalId');
  });

  it('keeps two posts that share an opening line but disagree on their Facebook id', async () => {
    await clearPosts();

    await upsertPosts([
      createHashIdentityPost({
        identityKey: 'postId:3001',
        identitySource: 'externalId',
        externalId: '3001',
      }),
      createHashIdentityPost({
        identityKey: 'postId:3002',
        identitySource: 'externalId',
        externalId: '3002',
      }),
    ]);

    expect(await countPosts()).toBe(2);
  });

  it('detects better parses', () => {
    const existing = createSamplePost(3, ['MISSING_REACTION_COUNT']);
    const incoming = {
      ...existing,
      reactionCount: 10,
      warnings: [],
    };

    expect(isBetterParse(existing, incoming)).toBe(true);
  });

  it('treats longer expanded text as a better parse', () => {
    const existing = createSamplePost(4, ['TRUNCATED_TEXT']);
    const incoming = {
      ...existing,
      text: 'Post 4 with the complete expanded text',
      updatedAt: new Date().toISOString(),
    };

    expect(isBetterParse(existing, incoming)).toBe(true);
  });

  it('keeps expanded comments when a later sighting only shows one comment', async () => {
    await clearPosts();
    const basePost = createSamplePost(8);
    const expanded: CapturedPost = {
      ...basePost,
      comments: [
        {
          commentId: '1',
          parentCommentId: null,
          depth: 0,
          author: { kind: 'named', name: 'Jane', profileUrl: null },
          text: 'First comment',
          displayedDate: '1 hour ago',
          publishedAt: basePost.publishedAt,
          reactionCount: null,
          reactionBreakdown: {},
          warnings: [],
        },
        {
          commentId: '2',
          parentCommentId: null,
          depth: 0,
          author: { kind: 'named', name: 'John', profileUrl: null },
          text: 'Second comment',
          displayedDate: '50 minutes ago',
          publishedAt: basePost.publishedAt,
          reactionCount: null,
          reactionBreakdown: {},
          warnings: [],
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    const thinned = {
      ...basePost,
      comments: expanded.comments.slice(0, 1),
      updatedAt: new Date().toISOString(),
    };

    await upsertPosts([expanded]);
    await upsertPosts([thinned]);

    const storedPosts = await listAllPosts();
    expect(storedPosts[0]?.comments).toHaveLength(2);
  });

  it('builds per-group stats from stored posts', async () => {
    await clearPosts();

    await upsertPosts([
      createSamplePost(1),
      {
        ...createSamplePost(2),
        collection: {
          name: 'Other Group',
          url: 'https://www.facebook.com/groups/other-group',
        },
        externalUrl: 'https://www.facebook.com/groups/other-group/permalink/2',
      },
    ]);

    const collectionStats = await listCollectionStats();

    expect(collectionStats).toHaveLength(2);
    expect(collectionStats.find((stat) => stat.collection.name === 'Sample Group')?.itemCount).toBe(1);
    expect(collectionStats.find((stat) => stat.collection.name === 'Other Group')?.itemCount).toBe(1);
  });

  it('filters paginated posts by group url', async () => {
    await clearPosts();

    const sampleGroupPost = createSamplePost(1);
    const otherGroupPost = {
      ...createSamplePost(2),
      collection: {
        name: 'Other Group',
        url: 'https://www.facebook.com/groups/other-group',
      },
      externalUrl: 'https://www.facebook.com/groups/other-group/permalink/2',
    };

    await upsertPosts([sampleGroupPost, otherGroupPost]);

    const filteredPage = await listPostsPage(
      'newestCapture',
      0,
      20,
      'https://www.facebook.com/groups/sample-group',
    );

    expect(filteredPage.total).toBe(1);
    expect(filteredPage.posts[0]?.collection.url).toBe(
      'https://www.facebook.com/groups/sample-group',
    );
  });

  it('clears one group without touching the others', async () => {
    await clearPosts();

    await upsertPosts([
      createSamplePost(1),
      {
        ...createSamplePost(2),
        collection: {
          name: 'Other Group',
          url: 'https://www.facebook.com/groups/other-group',
        },
        externalUrl: 'https://www.facebook.com/groups/other-group/permalink/2',
      },
    ]);

    await clearCollectionPosts('https://www.facebook.com/groups/sample-group');

    expect(await countPosts()).toBe(1);
    const remainingPosts = await listAllPosts();
    expect(remainingPosts[0]?.collection.name).toBe('Other Group');
  });

  // Captured in one order and published in another, which is the whole reason
  // publication order exists: post 1 was captured first and published last.
  async function storeThreePublishedDays(): Promise<void> {
    await clearPosts();

    await upsertPosts([
      createPostPublishedOn(1, '2026-03-03T09:00:00.000Z'),
      createPostPublishedOn(2, '2026-03-02T09:00:00.000Z'),
      createPostPublishedOn(3, '2026-03-01T09:00:00.000Z'),
    ]);
  }

  it('reads a group newest published first', async () => {
    await storeThreePublishedDays();

    const page = await listPostsPage('newestPublication', 0, 20);

    expect(page.posts.map((post) => post.publishedAt)).toEqual([
      '2026-03-03T09:00:00.000Z',
      '2026-03-02T09:00:00.000Z',
      '2026-03-01T09:00:00.000Z',
    ]);
  });

  it('reads a group oldest published first', async () => {
    await storeThreePublishedDays();

    const page = await listPostsPage('oldestPublication', 0, 20);

    expect(page.posts.map((post) => post.publishedAt)).toEqual([
      '2026-03-01T09:00:00.000Z',
      '2026-03-02T09:00:00.000Z',
      '2026-03-03T09:00:00.000Z',
    ]);
  });

  // A post whose date never parsed still has to be reachable, and it belongs at
  // the end of a newest-first read rather than at the head of every page.
  it('keeps an undated post enumerable, after the dated ones', async () => {
    await storeThreePublishedDays();
    await upsertPosts([createPostPublishedOn(4, null)]);

    const page = await listPostsPage('newestPublication', 0, 20);

    expect(page.total).toBe(4);
    expect(page.posts.map((post) => post.publishedAt)).toEqual([
      '2026-03-03T09:00:00.000Z',
      '2026-03-02T09:00:00.000Z',
      '2026-03-01T09:00:00.000Z',
      null,
    ]);
  });

  it('counts the posts a newest-first read reaches before a day', async () => {
    await storeThreePublishedDays();

    expect(await countPostsBeforeDay('newestPublication', '2026-03-02')).toBe(1);
  });

  it('counts the posts an oldest-first read reaches before a day', async () => {
    await storeThreePublishedDays();

    expect(await countPostsBeforeDay('oldestPublication', '2026-03-02')).toBe(1);
  });

  it('finds posts by a substring of a comment', async () => {
    await clearPosts();
    await upsertPosts([
      {
        ...createSamplePost(1),
        comments: [
          {
            commentId: 'c1',
            parentCommentId: null,
            depth: 0,
            author: { kind: 'named', name: 'Commenter', profileUrl: null },
            text: 'I can help with the réunion',
            displayedDate: '1 hour ago',
            publishedAt: null,
            reactionCount: null,
            reactionBreakdown: {},
            warnings: [],
          },
        ],
      },
      createSamplePost(2),
    ]);

    const page = await findPostsPage(
      'newestPublication',
      { warning: null, text: 'reunion' },
      0,
      20,
    );

    expect(page.posts.map((post) => post.externalId)).toEqual(['1']);
    expect(page.hasMore).toBe(false);
  });

  it('counts the stored posts under each warning code', async () => {
    await clearPosts();
    await upsertPosts([
      createSamplePost(1, ['MISSING_AUTHOR']),
      createSamplePost(2, ['MISSING_AUTHOR', 'MISSING_DATE']),
      createSamplePost(3),
    ]);

    expect(await countPostsByWarning()).toEqual(
      new Map([
        ['MISSING_AUTHOR', 2],
        ['MISSING_DATE', 1],
      ]),
    );
  });

  it('finds only the posts carrying a warning code', async () => {
    await clearPosts();
    await upsertPosts([
      createSamplePost(1, ['MISSING_AUTHOR']),
      createSamplePost(2),
    ]);

    const page = await findPostsPage(
      'newestPublication',
      { warning: 'MISSING_AUTHOR', text: null },
      0,
      20,
    );

    expect(page.posts.map((post) => post.externalId)).toEqual(['1']);
  });
});
