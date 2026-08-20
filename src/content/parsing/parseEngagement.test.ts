import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEngagement } from './parseEngagement';

const fixturesDirectory = join(import.meta.dirname, '__fixtures__');

function loadFixture(name: string): Element {
  const html = readFileSync(join(fixturesDirectory, name), 'utf8');
  document.body.innerHTML = html;
  const postElement = document.body.querySelector('[data-focus="feed_story"]');
  if (postElement === null) {
    throw new Error(`Post fixture "${name}" has no post root`);
  }

  return postElement;
}

describe('parseEngagement', () => {
  it('reads footer totals and the visible reaction breakdown', () => {
    const postElement = loadFixture('post-with-reaction-breakdown.html');
    const engagement = parseEngagement(postElement);

    expect(engagement.reactionCount).toBe(535);
    expect(engagement.reactionBreakdown).toEqual({
      like: 375,
      love: 142,
    });
    expect(engagement.commentCount).toBe(22);
    expect(engagement.shareCount).toBe(2);
  });

  it('falls back to aggregate reaction labels on older markup', () => {
    document.body.innerHTML = `
      <div data-focus="feed_story">
        <span aria-label="12 reactions">12</span>
      </div>
    `;
    const postElement = document.querySelector('[data-focus="feed_story"]');
    if (postElement === null) {
      throw new Error('Fixture is invalid');
    }

    const engagement = parseEngagement(postElement);

    expect(engagement.reactionCount).toBe(12);
    expect(engagement.reactionBreakdown).toEqual({});
  });

  it('does not treat a per-type label as the total reaction count', () => {
    document.body.innerHTML = `
      <div data-focus="feed_story">
        <span aria-label="See who reacted to this" role="toolbar">
          <div aria-label="Like: 375 people" role="button"></div>
        </span>
      </div>
    `;
    const postElement = document.querySelector('[data-focus="feed_story"]');
    if (postElement === null) {
      throw new Error('Fixture is invalid');
    }

    const engagement = parseEngagement(postElement);

    expect(engagement.reactionCount).toBe(375);
    expect(engagement.reactionBreakdown).toEqual({ like: 375 });
  });
});
