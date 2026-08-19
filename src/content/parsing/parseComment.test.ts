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
});
