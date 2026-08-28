import { describe, expect, it } from 'vitest';
import { parseComment } from './parseComment';

describe('parseComment', () => {
  it('parses French Comet comment metadata from its aria-label', () => {
    document.documentElement.lang = 'fr';
    document.body.innerHTML = `
      <div
        role="article"
        aria-label="Commentaire de Jeanne il y a 2 heures"
      >
        <div dir="auto">Commentaire visible</div>
      </div>
    `;
    const commentElement = document.querySelector('[role="article"]');
    if (commentElement === null) {
      throw new Error('Comment fixture is invalid');
    }

    const parsed = parseComment(commentElement);

    expect(parsed.author).toEqual({
      kind: 'named',
      name: 'Jeanne',
      profileUrl: null,
    });
    expect(parsed.displayedDate).toBe('il y a 2 heures');
    expect(parsed.publishedAt).not.toBeNull();
  });

  it('parses comment text without the author name or follow button', () => {
    document.body.innerHTML = `
      <div data-commentid="42">
        <div role="article" aria-label="Comment by Parent Author 30 minutes ago">
          <div role="heading"><span dir="auto">Parent Author</span></div>
          <div role="button" tabindex="0"><span dir="auto">Follow</span></div>
          <div dir="auto">Parent comment text</div>
        </div>
      </div>
    `;
    const commentElement = document.querySelector('[role="article"]');
    if (commentElement === null) {
      throw new Error('Comment fixture is invalid');
    }

    const parsed = parseComment(commentElement, {
      commentId: '42',
      parentCommentId: null,
      depth: 0,
    });

    expect(parsed.text).toBe('Parent comment text');
    expect(parsed.commentId).toBe('42');
  });
});
