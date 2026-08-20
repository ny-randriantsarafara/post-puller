import { describe, expect, it } from 'vitest';
import {
  clearGroupPosts,
  clearPosts,
  countPosts,
  isBetterParse,
  listAllPosts,
  listGroupStats,
  listPostsPage,
  upsertPosts,
} from './postRepository';
import type { CapturedPost } from '../types';

function createSamplePost(index: number, warnings: CapturedPost['warnings'] = []): CapturedPost {
  const identity = String(index);
  const capturedAt = new Date(2026, 7, 19, 12, 0, index).toISOString();

  return {
    identityKey: `postId:${identity}`,
    identitySource: 'postId',
    fingerprint: null,
    postId: identity,
    postUrl: `https://www.facebook.com/groups/sample-group/permalink/${identity}`,
    group: {
      name: 'Sample Group',
      url: 'https://www.facebook.com/groups/sample-group',
    },
    author: { kind: 'named', name: `Author ${identity}`, profileUrl: null },
    text: `Post ${identity}`,
    displayedDate: '1 hour ago',
    publishedAt: capturedAt,
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
    postId: null,
    postUrl: null,
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
      postId: null,
      postUrl: null,
      author: { kind: 'unknown' },
      text: null,
      displayedDate: null,
    };

    await upsertPosts([createSamplePost(7)]);
    await upsertPosts([emptyStory, { ...emptyStory, reactionCount: 99 }]);

    const storedPosts = await listAllPosts();
    expect(storedPosts).toHaveLength(1);
    expect(storedPosts[0]?.postId).toBe('7');
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
        identitySource: 'postId',
        postId: '2001',
        postUrl: 'https://www.facebook.com/groups/sample-group/posts/2001/',
      }),
    ]);

    const storedPosts = await listAllPosts();
    expect(storedPosts).toHaveLength(1);
    expect(storedPosts[0]?.identityKey).toBe('postId:2001');
    expect(storedPosts[0]?.identitySource).toBe('postId');
  });

  it('keeps two posts that share an opening line but disagree on their Facebook id', async () => {
    await clearPosts();

    await upsertPosts([
      createHashIdentityPost({
        identityKey: 'postId:3001',
        identitySource: 'postId',
        postId: '3001',
      }),
      createHashIdentityPost({
        identityKey: 'postId:3002',
        identitySource: 'postId',
        postId: '3002',
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
    const expanded = {
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
        group: {
          name: 'Other Group',
          url: 'https://www.facebook.com/groups/other-group',
        },
        postUrl: 'https://www.facebook.com/groups/other-group/permalink/2',
      },
    ]);

    const groupStats = await listGroupStats();

    expect(groupStats).toHaveLength(2);
    expect(groupStats.find((stat) => stat.group.name === 'Sample Group')?.postCount).toBe(1);
    expect(groupStats.find((stat) => stat.group.name === 'Other Group')?.postCount).toBe(1);
  });

  it('filters paginated posts by group url', async () => {
    await clearPosts();

    const sampleGroupPost = createSamplePost(1);
    const otherGroupPost = {
      ...createSamplePost(2),
      group: {
        name: 'Other Group',
        url: 'https://www.facebook.com/groups/other-group',
      },
      postUrl: 'https://www.facebook.com/groups/other-group/permalink/2',
    };

    await upsertPosts([sampleGroupPost, otherGroupPost]);

    const filteredPage = await listPostsPage(
      0,
      20,
      'https://www.facebook.com/groups/sample-group',
    );

    expect(filteredPage.total).toBe(1);
    expect(filteredPage.posts[0]?.group.url).toBe(
      'https://www.facebook.com/groups/sample-group',
    );
  });

  it('clears one group without touching the others', async () => {
    await clearPosts();

    await upsertPosts([
      createSamplePost(1),
      {
        ...createSamplePost(2),
        group: {
          name: 'Other Group',
          url: 'https://www.facebook.com/groups/other-group',
        },
        postUrl: 'https://www.facebook.com/groups/other-group/permalink/2',
      },
    ]);

    await clearGroupPosts('https://www.facebook.com/groups/sample-group');

    expect(await countPosts()).toBe(1);
    const remainingPosts = await listAllPosts();
    expect(remainingPosts[0]?.group.name).toBe('Other Group');
  });
});
