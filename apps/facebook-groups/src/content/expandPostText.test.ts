import { describe, expect, it, vi } from 'vitest';
import { clickPostTextExpansionControls } from './expandPostText';

describe('clickPostTextExpansionControls', () => {
  it('clicks See more controls inside the post message only', () => {
    document.body.innerHTML = `
      <div data-focus="feed_story">
        <div data-ad-preview="message">
          Truncated text…
          <div id="message-expand" role="button">See more</div>
        </div>
        <div id="comment-expand" role="button">See more</div>
      </div>
    `;
    const post = document.querySelector('[data-focus="feed_story"]');
    const messageExpand = document.getElementById('message-expand');
    const commentExpand = document.getElementById('comment-expand');

    if (post === null || messageExpand === null || commentExpand === null) {
      throw new Error('Expansion test fixture is invalid');
    }

    const messageClick = vi.spyOn(messageExpand, 'click');
    const commentClick = vi.spyOn(commentExpand, 'click');

    expect(clickPostTextExpansionControls(post, 2)).toBe(1);
    expect(messageClick).toHaveBeenCalledOnce();
    expect(commentClick).not.toHaveBeenCalled();
  });

  it('never clicks controls nested in a link, which would navigate away', () => {
    document.body.innerHTML = `
      <div data-focus="feed_story">
        <div data-ad-preview="message">
          <a href="/groups/sample-group/posts/1">
            <div id="linked-expand" role="button">See more</div>
          </a>
        </div>
      </div>
    `;
    const post = document.querySelector('[data-focus="feed_story"]');
    const linkedExpand = document.getElementById('linked-expand');

    if (post === null || linkedExpand === null) {
      throw new Error('Expansion test fixture is invalid');
    }

    const linkedClick = vi.spyOn(linkedExpand, 'click');

    expect(clickPostTextExpansionControls(post, 2)).toBe(0);
    expect(linkedClick).not.toHaveBeenCalled();
  });

  it('respects the remaining click limit', () => {
    document.body.innerHTML = `
      <div data-focus="feed_story">
        <div data-ad-preview="message">
          <div role="button">See more</div>
          <div role="button">Voir plus</div>
        </div>
      </div>
    `;
    const post = document.querySelector('[data-focus="feed_story"]');
    if (post === null) {
      throw new Error('Expansion test fixture is invalid');
    }

    expect(clickPostTextExpansionControls(post, 1)).toBe(1);
    expect(clickPostTextExpansionControls(post, 0)).toBe(0);
  });
});
