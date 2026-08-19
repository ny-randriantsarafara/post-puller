import { describe, expect, it } from 'vitest';
import { findRenderedPostRoots, findContainingPostRoot } from './postRoots';

describe('post root discovery', () => {
  it('finds rendered Comet feed stories and ignores virtualized placeholders', () => {
    document.body.innerHTML = `
      <div role="feed">
        <div data-focus="feed_story">
          <div data-ad-preview="message">Rendered post</div>
        </div>
        <div data-focus="feed_story">
          <div data-virtualized="true"><div hidden></div></div>
        </div>
        <div data-focus="feed_story">
          <span aria-label="Like: 3 people">3</span>
        </div>
      </div>
    `;

    const postRoots = findRenderedPostRoots(document.body);

    expect(postRoots).toHaveLength(1);
  });

  it('maps a comment mutation back to its containing post root', () => {
    document.body.innerHTML = `
      <div data-focus="feed_story">
        <div data-ad-preview="message">Post</div>
        <div role="article" aria-label="Comment by Jane 2 hours ago">
          <span id="comment-text">Comment</span>
        </div>
      </div>
    `;
    const commentText = document.getElementById('comment-text');

    expect(findContainingPostRoot(commentText)).toBe(
      document.querySelector('[data-focus="feed_story"]'),
    );
  });
});
