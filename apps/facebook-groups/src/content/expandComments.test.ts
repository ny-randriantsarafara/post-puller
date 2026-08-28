import { describe, expect, it } from 'vitest';
import { clickCommentExpansionControls } from './expandComments';

describe('clickCommentExpansionControls', () => {
  it('clicks comment expansion controls up to the remaining budget', () => {
    const clickedLabels: string[] = [];
    document.body.innerHTML = `
      <div data-focus="feed_story">
        <div role="button">View more comments</div>
        <div role="button">View all 3 replies</div>
        <div role="button">View 1 reply</div>
      </div>
    `;
    const postElement = document.querySelector('[data-focus="feed_story"]');
    if (postElement === null) {
      throw new Error('Fixture is invalid');
    }

    for (const button of postElement.querySelectorAll('[role="button"]')) {
      button.addEventListener('click', () => {
        clickedLabels.push(button.textContent);
      });
    }

    const clickCount = clickCommentExpansionControls(postElement, 2);

    expect(clickCount).toBe(2);
    expect(clickedLabels).toEqual(['View more comments', 'View all 3 replies']);
  });

  it('does not click controls nested inside links', () => {
    let clickCount = 0;
    document.body.innerHTML = `
      <div data-focus="feed_story">
        <a href="/groups/sample/posts/1/">
          <div role="button">View more comments</div>
        </a>
      </div>
    `;
    const postElement = document.querySelector('[data-focus="feed_story"]');
    if (postElement === null) {
      throw new Error('Fixture is invalid');
    }

    const button = postElement.querySelector('[role="button"]');
    button?.addEventListener('click', () => {
      clickCount += 1;
    });

    expect(clickCommentExpansionControls(postElement, 3)).toBe(0);
    expect(clickCount).toBe(0);
  });
});
