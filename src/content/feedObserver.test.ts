import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturedPost } from '../shared/types';
import { FeedObserver } from './feedObserver';

const FLUSH_MS = 1000;
const FEED_RECHECK_MS = 3000;

function renderStory(postId: string, postText: string): string {
  return `
    <div data-focus="feed_story">
      <h3><a href="/groups/sample-group/user/1/">Sample Author</a></h3>
      <div data-ad-preview="message">
        ${postText}
        <div role="button">See more</div>
      </div>
      <a href="/groups/sample-group/posts/${postId}/">
        <time datetime="2026-08-18T10:00:00.000Z">Yesterday</time>
      </a>
    </div>
  `;
}

function renderFeed(postText: string): void {
  document.body.innerHTML = `
    <div role="feed">${renderStory('1855528195424558', postText)}</div>
  `;
}

function readPostElement(): Element {
  const postElement = document.querySelector('[data-focus="feed_story"]');
  if (postElement === null) {
    throw new Error('Feed fixture is invalid');
  }

  return postElement;
}

describe('FeedObserver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.pushState({}, '', '/groups/sample-group');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures a truncated post instead of waiting for text expansion', async () => {
    renderFeed('Truncated text…');
    const capturedBatches: CapturedPost[][] = [];
    const observer = new FeedObserver({
      onPostsCaptured: (posts) => capturedBatches.push(posts),
      onInterrupted: () => undefined,
    });

    observer.start();
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    observer.stop();

    expect(capturedBatches.flat()).toHaveLength(1);
    expect(capturedBatches.flat()[0]?.postId).toBe('1855528195424558');
    expect(capturedBatches.flat()[0]?.warnings).toContain('TRUNCATED_TEXT');
  });

  it('stops expanding a post once its click budget is spent, even when Facebook replaces the post node', async () => {
    renderFeed('Truncated text…');
    const observer = new FeedObserver({
      onPostsCaptured: () => undefined,
      onInterrupted: () => undefined,
    });
    const clickedLabels: string[] = [];
    document.addEventListener('click', (event) => {
      if (event.target instanceof HTMLElement) {
        clickedLabels.push(event.target.textContent.trim());
      }
    });

    observer.start();

    // Facebook's Comet renderer swaps the story node on every re-render, so the
    // click budget must survive node identity changes.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await vi.advanceTimersByTimeAsync(FLUSH_MS);
      readPostElement().replaceWith(readPostElement().cloneNode(true));
    }

    observer.stop();

    expect(clickedLabels.length).toBeLessThanOrEqual(3);
  });

  it('drops posts Facebook virtualized away before the flush ran', async () => {
    document.body.innerHTML = `
      <div role="feed">
        ${renderStory('1001', 'Post kept in the viewport')}
        ${renderStory('1002', 'Post scrolled out of the viewport')}
      </div>
    `;
    const capturedBatches: CapturedPost[][] = [];
    const observer = new FeedObserver({
      onPostsCaptured: (posts) => capturedBatches.push(posts),
      onInterrupted: () => undefined,
    });

    observer.start();

    // Comet empties a story as soon as it leaves the viewport, so its content can
    // be gone by the time the debounced flush parses it.
    const stories = [...document.querySelectorAll('[data-focus="feed_story"]')];
    const scrolledAwayStory = stories[1];
    if (scrolledAwayStory === undefined) {
      throw new Error('Feed fixture is invalid');
    }
    scrolledAwayStory.innerHTML = '<div data-virtualized="true"></div>';

    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    observer.stop();

    const capturedPostIds = capturedBatches.flat().map((post) => post.postId);
    expect(capturedPostIds).toEqual(['1001']);
  });

  it('captures while unrelated feed churn keeps arriving', async () => {
    document.body.innerHTML = `<div role="feed">${renderStory('1001', 'Post')}</div>`;
    const capturedBatches: CapturedPost[][] = [];
    const observer = new FeedObserver({
      onPostsCaptured: (posts) => capturedBatches.push(posts),
      onInterrupted: () => undefined,
    });
    const feed = document.querySelector('[role="feed"]');
    if (feed === null) {
      throw new Error('Feed fixture is invalid');
    }

    observer.start();

    // Scrolling makes Comet touch the feed constantly. Bursts arriving faster
    // than the debounce must not postpone capture indefinitely.
    for (let tick = 0; tick < 8; tick += 1) {
      feed.append(document.createElement('div'));
      await vi.advanceTimersByTimeAsync(300);
    }

    observer.stop();

    expect(capturedBatches.flat().map((post) => post.postId)).toContain('1001');
  });

  it('captures while the post itself keeps mutating', async () => {
    document.body.innerHTML = `<div role="feed">${renderStory('1001', 'Post')}</div>`;
    const capturedBatches: CapturedPost[][] = [];
    const observer = new FeedObserver({
      onPostsCaptured: (posts) => capturedBatches.push(posts),
      onInterrupted: () => undefined,
    });

    observer.start();

    for (let tick = 0; tick < 8; tick += 1) {
      readPostElement().setAttribute('data-render-tick', String(tick));
      await vi.advanceTimersByTimeAsync(300);
    }

    observer.stop();

    expect(capturedBatches.flat().map((post) => post.postId)).toContain('1001');
  });

  it('recaptures a post when expansion only swaps its message text', async () => {
    renderFeed('Truncated text…');
    const capturedBatches: CapturedPost[][] = [];
    const observer = new FeedObserver({
      onPostsCaptured: (posts) => capturedBatches.push(posts),
      onInterrupted: () => undefined,
    });

    observer.start();
    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    const message = readPostElement().querySelector('[data-ad-preview="message"]');
    if (message === null) {
      throw new Error('Feed fixture is invalid');
    }

    // Expanding a message drops the control and inserts a plain text node.
    message.textContent = 'Truncated text, now shown in full';

    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    observer.stop();

    const capturedTexts = capturedBatches.flat().map((post) => post.text);
    expect(capturedTexts).toContain('Truncated text, now shown in full');
  });

  it('keeps capturing after Facebook replaces the feed container', async () => {
    renderFeed('First post');
    const capturedBatches: CapturedPost[][] = [];
    const observer = new FeedObserver({
      onPostsCaptured: (posts) => capturedBatches.push(posts),
      onInterrupted: () => undefined,
    });

    observer.start();
    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    const replacementFeed = document.createElement('div');
    replacementFeed.setAttribute('role', 'feed');
    replacementFeed.innerHTML = renderStory('1855546442089400', 'Second post');
    document.querySelector('[role="feed"]')?.replaceWith(replacementFeed);

    await vi.advanceTimersByTimeAsync(FEED_RECHECK_MS);
    observer.stop();

    const capturedPostIds = capturedBatches.flat().map((post) => post.postId);
    expect(capturedPostIds).toContain('1855528195424558');
    expect(capturedPostIds).toContain('1855546442089400');
  });
});
