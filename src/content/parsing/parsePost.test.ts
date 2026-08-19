import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePost } from './parsePost';

const fixturesDirectory = join(import.meta.dirname, '__fixtures__');

function loadFixture(name: string): Element {
  const html = readFileSync(join(fixturesDirectory, name), 'utf8');
  document.body.innerHTML = html;
  const postElement = document.body.querySelector(
    '[data-focus="feed_story"], [role="article"]',
  );

  if (postElement === null) {
    throw new Error(`Post fixture "${name}" has no post root`);
  }

  return postElement;
}

const group = {
  name: 'Sample Group',
  url: 'https://www.facebook.com/groups/sample-group',
};

describe('parsePost', () => {
  it('parses a text post with a visible comment', () => {
    const postElement = loadFixture('text-post-with-comment.html');
    const parsed = parsePost(postElement, group);

    expect(parsed.postId).toBe('1234567890');
    expect(parsed.text).toContain('sample post');
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.reactionCount).toBe(12);
  });

  it('parses anonymous posts', () => {
    const postElement = loadFixture('anonymous-post.html');
    const parsed = parsePost(postElement, group);

    expect(parsed.author.kind).toBe('anonymous');
    expect(parsed.warnings).toContain('MISSING_POST_ID');
  });

  it('flags truncated posts', () => {
    const postElement = loadFixture('truncated-post.html');
    const parsed = parsePost(postElement, group);

    expect(parsed.warnings).toContain('TRUNCATED_TEXT');
  });

  it('flags collapsed comments', () => {
    const postElement = loadFixture('collapsed-comments-post.html');
    const parsed = parsePost(postElement, group);

    expect(parsed.warnings).toContain('COLLAPSED_COMMENTS');
    expect(parsed.warnings).toContain('HIDDEN_COMMENTS');
  });

  it('parses attachment metadata', () => {
    const postElement = loadFixture('attachment-post.html');
    const parsed = parsePost(postElement, group);

    expect(parsed.attachments[0]?.kind).toBe('image');
  });

  it('parses the current Comet post structure', () => {
    const postElement = loadFixture('comet-post.html');
    const parsed = parsePost(postElement, group);

    expect(parsed.postId).toBe('1855528195424558');
    expect(parsed.postUrl).toBe(
      'https://www.facebook.com/groups/sample-group/posts/1855528195424558/',
    );
    expect(parsed.author).toEqual({
      kind: 'named',
      name: 'Minola32',
      profileUrl: null,
    });
    expect(parsed.text).toBe('A current Comet post…');
    expect(parsed.displayedDate).toBe('23 hours ago');
    expect(parsed.reactionCount).toBe(7);
    expect(parsed.attachments).toEqual([
      {
        kind: 'image',
        url: 'https://example.com/post.jpg',
      },
    ]);
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments[0]?.author).toEqual({
      kind: 'named',
      name: 'SkilledBee3792',
      profileUrl: null,
    });
    expect(parsed.comments[0]?.displayedDate).toBe('2 hours ago');
  });

  it('parses date from abbr in the post card outside feed_story', () => {
    const postElement = loadFixture('comet-header-date-post.html');
    const parsed = parsePost(postElement, group);

    expect(parsed.displayedDate).toBe('a day ago');
    expect(parsed.publishedAt).not.toBeNull();
    expect(parsed.warnings).not.toContain('MISSING_DATE');
  });

  it('parses date from abbr aria-label', () => {
    const postElement = loadFixture('abbr-date-post.html');
    const parsed = parsePost(postElement, group);

    expect(parsed.displayedDate).toBe('a day ago');
    expect(parsed.publishedAt).not.toBeNull();
    expect(parsed.warnings).not.toContain('MISSING_DATE');
  });

  it('parses date from compact visible text without abbr', () => {
    const postElement = loadFixture('compact-date-post.html');
    const parsed = parsePost(postElement, group);

    expect(parsed.displayedDate).toBe('2h');
    expect(parsed.publishedAt).not.toBeNull();
    expect(parsed.warnings).not.toContain('MISSING_DATE');
  });

  it('does not use a comment timestamp as the post date', () => {
    const postElement = loadFixture('comment-date-not-post-date.html');
    const parsed = parsePost(postElement, group);

    expect(parsed.displayedDate).toBe('a day ago');
    expect(parsed.displayedDate).not.toBe('1w');
  });

  it('builds a canonical post URL from the post id', () => {
    const postElement = loadFixture('abbr-date-post.html');
    const parsed = parsePost(postElement, group);

    expect(parsed.postId).toBe('9001');
    expect(parsed.postUrl).toBe(
      'https://www.facebook.com/groups/sample-group/posts/9001/',
    );
  });

  it('extracts post id from a photo link set=gm parameter', () => {
    const postElement = loadFixture('photo-link-post.html');
    const parsed = parsePost(postElement, group);

    expect(parsed.postId).toBe('9004');
    expect(parsed.postUrl).toBe(
      'https://www.facebook.com/groups/sample-group/posts/9004/',
    );
  });

  it('does not flag a post for a comment text expansion control', () => {
    document.body.innerHTML = `
      <div data-focus="feed_story">
        <h2><div role="button">Anonymous member</div></h2>
        <a href="/groups/sample-group/posts/2001/" aria-label="1 hour ago">Post</a>
        <div data-ad-preview="message"><div dir="auto">Complete post text</div></div>
        <div role="article" aria-label="Comment by Jane 20 minutes ago">
          <div dir="auto">
            Truncated comment…
            <div role="button">See more</div>
          </div>
        </div>
      </div>
    `;
    const postElement = document.querySelector('[data-focus="feed_story"]');
    if (postElement === null) {
      throw new Error('Post fixture is invalid');
    }

    const parsed = parsePost(postElement, group);

    expect(parsed.warnings).not.toContain('TRUNCATED_TEXT');
  });
});
