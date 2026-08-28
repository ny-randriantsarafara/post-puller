import { describe, expect, it } from 'vitest';
import {
  finalizeCapturedPost,
  resolvePostIdentity,
  retainCapturedIdentity,
} from './postIdentity';
import { normalizePostUrl } from './postUrl';
import type { ParsedPostDraft } from '../types';

const baseDraft: ParsedPostDraft = {
  postId: null,
  postUrl: null,
  group: { name: 'Sample Group', url: 'https://www.facebook.com/groups/sample-group' },
  author: { kind: 'named', name: 'Jane Doe', profileUrl: null },
  text: 'Sample text',
  displayedDate: '2 hours ago',
  publishedAt: null,
  reactionCount: 1,
  reactionBreakdown: {},
  commentCount: null,
  shareCount: null,
  comments: [],
  attachments: [{ kind: 'none' }],
  warnings: [],
};

describe('post identity resolution', () => {
  it('prefers post id when available', async () => {
    const identity = await resolvePostIdentity(
      {
        ...baseDraft,
        postId: '123',
        postUrl: 'https://www.facebook.com/groups/sample-group/permalink/123/?ref=feed',
      },
      null,
    );

    expect(identity.identitySource).toBe('postId');
    expect(identity.identityKey).toBe('postId:123');
    expect(normalizePostUrl(identity.postUrl)).toBe(
      'https://www.facebook.com/groups/sample-group/permalink/123',
    );
  });

  it('uses post url identity when the url has no extractable post id', async () => {
    const identity = await resolvePostIdentity(
      {
        ...baseDraft,
        postUrl: 'https://www.facebook.com/groups/sample-group?post_id=456',
      },
      null,
    );

    expect(identity.identitySource).toBe('postUrl');
    expect(identity.identityKey).toBe(
      'postUrl:https://www.facebook.com/groups/sample-group',
    );
  });

  it('falls back to content hash when id and url are missing', async () => {
    const identity = await resolvePostIdentity(baseDraft, null);

    expect(identity.identitySource).toBe('contentHash');
    expect(identity.identityKey.startsWith('contentHash:')).toBe(true);
  });

  it('retains the first identity when a hydrated post later exposes its id', async () => {
    const previousPost = await finalizeCapturedPost(
      baseDraft,
      null,
      '2026-08-19T10:00:00.000Z',
    );
    const hydratedPost = await finalizeCapturedPost(
      {
        ...baseDraft,
        postId: '123',
        postUrl: 'https://www.facebook.com/groups/sample-group/posts/123/',
      },
      null,
      '2026-08-19T10:00:01.000Z',
    );

    const retainedPost = retainCapturedIdentity(previousPost, hydratedPost);

    expect(retainedPost.identityKey).toBe(previousPost.identityKey);
    expect(retainedPost.identitySource).toBe('contentHash');
    expect(retainedPost.postId).toBe('123');
  });
});
