import { describe, expect, it } from 'vitest';
import type { CapturedComment } from './types';
import { mergeComments } from './captureQuality';

function createComment(
  commentId: string,
  text: string,
  overrides: Partial<CapturedComment> = {},
): CapturedComment {
  return {
    commentId,
    parentCommentId: null,
    depth: 0,
    author: { kind: 'named', name: 'Jane', profileUrl: null },
    text,
    displayedDate: '1 hour ago',
    publishedAt: '2026-08-19T11:00:00.000Z',
    reactionCount: null,
    reactionBreakdown: {},
    warnings: [],
    ...overrides,
  };
}

describe('mergeComments', () => {
  it('keeps the longer text for the same comment id', () => {
    const existing = [createComment('1', 'Short')];
    const incoming = [createComment('1', 'Short with more detail')];

    const merged = mergeComments(existing, incoming);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe('Short with more detail');
  });

  it('keeps comments from both sightings', () => {
    const existing = [createComment('1', 'First')];
    const incoming = [createComment('2', 'Second')];

    const merged = mergeComments(existing, incoming);

    expect(merged).toHaveLength(2);
  });
});
