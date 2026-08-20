import type { CapturedPost, GroupInfo } from '../shared/types';
import { toErrorMessage } from '../shared/errorMessage';
import {
  finalizeCapturedPost,
  retainCapturedIdentity,
} from '../shared/identity/postIdentity';
import { isBetterCapturedPost } from '../shared/captureQuality';
import { clickPostTextExpansionControls } from './expandPostText';
import { clickCommentExpansionControls } from './expandComments';
import { getGroupPageInfo } from './groupPage';
import { parsePost } from './parsing/parsePost';
import { SELECTORS } from './parsing/selectors';
import {
  findContainingPostRoot,
  findRenderedPostRoots,
  isCapturablePostRoot,
} from './postRoots';

const DEBOUNCE_MS = 400;
export const MAX_FLUSH_WAIT_MS = 1000;
const FEED_RECHECK_MS = 2000;
const MAX_EXPANSION_CLICKS_PER_POST = 3;
const MAX_COMMENT_EXPANSION_CLICKS_PER_POST = 3;
const BATCH_SIZE = 20;

export type FeedObserverStartOptions = {
  expandComments?: boolean;
};

export type FeedObserverCallbacks = {
  onPostsCaptured: (posts: CapturedPost[]) => void;
  onInterrupted: () => void;
};

type TruncatedPost = {
  element: Element;
  identityKey: string;
};

type ExpandableCommentsPost = {
  element: Element;
  identityKey: string;
};

export class FeedObserver {
  private readonly callbacks: FeedObserverCallbacks;
  private readonly observedPosts = new WeakMap<Element, CapturedPost>();
  private readonly expansionClickCounts = new Map<string, number>();
  private readonly commentExpansionClickCounts = new Map<string, number>();
  private expandComments = false;
  private readonly pendingElements = new Set<Element>();
  private observer: MutationObserver | null = null;
  private observedFeedRoot: Element | null = null;
  private debounceTimer: number | null = null;
  private flushDeadline: number | null = null;
  private feedRecheckTimer: number | null = null;
  private isActive = false;

  constructor(callbacks: FeedObserverCallbacks) {
    this.callbacks = callbacks;
  }

  start(options: FeedObserverStartOptions = {}): void {
    if (this.isActive) {
      return;
    }

    this.expandComments = options.expandComments ?? false;

    const pageInfo = getGroupPageInfo();
    if (!pageInfo.isGroupPage || pageInfo.groupUrl === null) {
      return;
    }

    this.isActive = true;

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element) {
              this.collectPostElements(node);
              return;
            }

            // Expanded message text arrives as a plain text node, so the post
            // has to be found from the container that received it.
            this.collectContainingPost(mutation.target);
          });
        }

        if (mutation.type === 'characterData' || mutation.type === 'attributes') {
          const target = mutation.target;
          if (target instanceof Element) {
            this.collectPostElements(target);
          }

          if (target.parentElement !== null) {
            this.collectPostElements(target.parentElement);
          }
        }
      }
    });

    this.observeFeedRoot();

    this.feedRecheckTimer = window.setInterval(() => {
      this.observeFeedRoot();
    }, FEED_RECHECK_MS);
  }

  stop(): void {
    this.isActive = false;

    if (this.observer !== null) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.observedFeedRoot = null;

    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.flushDeadline = null;

    if (this.feedRecheckTimer !== null) {
      window.clearInterval(this.feedRecheckTimer);
      this.feedRecheckTimer = null;
    }

    this.pendingElements.clear();
    this.expandComments = false;
  }

  interrupt(): void {
    this.stop();
    this.callbacks.onInterrupted();
  }

  private resolveFeedRoot(): Element {
    return document.querySelector(SELECTORS.feed) ?? document.body;
  }

  // Comet can replace the whole feed container, which leaves the observer
  // watching a detached node and silently stops capture. Re-attaching keeps the
  // session alive, and the follow-up scan recovers posts missed in between.
  private observeFeedRoot(): void {
    if (this.observer === null) {
      return;
    }

    const feedRoot = this.resolveFeedRoot();
    if (this.observedFeedRoot === feedRoot && feedRoot.isConnected) {
      return;
    }

    this.observer.disconnect();
    this.observer.observe(feedRoot, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    this.observedFeedRoot = feedRoot;

    this.scanFeed();
  }

  private scanFeed(): void {
    const postRoots = findRenderedPostRoots(this.resolveFeedRoot());
    postRoots.forEach((postRoot) => this.pendingElements.add(postRoot));

    this.scheduleFlush();
  }

  private collectContainingPost(node: Node): void {
    const element = node instanceof Element ? node : node.parentElement;
    if (element === null) {
      return;
    }

    const containingPostRoot = findContainingPostRoot(element);
    if (containingPostRoot === null) {
      return;
    }

    this.pendingElements.add(containingPostRoot);
    this.scheduleFlush();
  }

  private collectPostElements(root: Element): void {
    const containingPostRoot = findContainingPostRoot(root);
    if (containingPostRoot !== null) {
      this.pendingElements.add(containingPostRoot);
    }

    const nestedPostRoots = findRenderedPostRoots(root);
    nestedPostRoots.forEach((postRoot) => this.pendingElements.add(postRoot));

    if (containingPostRoot !== null || nestedPostRoots.length > 0) {
      this.scheduleFlush();
    }
  }

  // Scrolling produces a continuous mutation stream, so a plain debounce would
  // keep postponing capture until scrolling stops. By then Comet has already
  // emptied the posts that scrolled past. The deadline bounds that delay.
  private scheduleFlush(): void {
    const now = Date.now();
    const deadline = this.flushDeadline ?? now + MAX_FLUSH_WAIT_MS;
    this.flushDeadline = deadline;

    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }

    const delay = Math.min(DEBOUNCE_MS, Math.max(0, deadline - now));

    this.debounceTimer = window.setTimeout(() => {
      this.flushDeadline = null;
      void this.flushPendingPosts();
    }, delay);
  }

  private async flushPendingPosts(): Promise<void> {
    if (!this.isActive || this.pendingElements.size === 0) {
      return;
    }

    const pageInfo = getGroupPageInfo();
    if (!pageInfo.isGroupPage || pageInfo.groupUrl === null) {
      this.interrupt();
      return;
    }

    const group = {
      name: pageInfo.groupName,
      url: pageInfo.groupUrl,
    };

    const capturedPosts: CapturedPost[] = [];
    const truncatedPosts: TruncatedPost[] = [];
    const expandableCommentsPosts: ExpandableCommentsPost[] = [];
    const elements = [...this.pendingElements];
    this.pendingElements.clear();

    for (const element of elements) {
      if (!isCapturablePostRoot(element)) {
        continue;
      }

      const capturedPost = await this.capturePost(element, group);
      if (capturedPost === null) {
        continue;
      }

      if (capturedPost.warnings.includes('TRUNCATED_TEXT')) {
        truncatedPosts.push({
          element,
          identityKey: capturedPost.identityKey,
        });
      }

      if (
        this.expandComments &&
        (capturedPost.warnings.includes('COLLAPSED_COMMENTS') ||
          capturedPost.warnings.includes('MISSING_COMMENTS'))
      ) {
        expandableCommentsPosts.push({
          element,
          identityKey: capturedPost.identityKey,
        });
      }

      const previousPost = this.observedPosts.get(element);
      if (
        previousPost !== undefined &&
        !isBetterCapturedPost(previousPost, capturedPost)
      ) {
        continue;
      }

      this.observedPosts.set(element, capturedPost);
      capturedPosts.push(capturedPost);
    }

    this.emitCapturedPosts(capturedPosts);

    // Expanding after emitting keeps capture independent of Facebook honouring
    // our clicks. Each click mutates the feed, so the observer re-parses the
    // post and the longer text is emitted as a better version of the same post.
    this.expandTruncatedPosts(truncatedPosts);
    this.expandCollapsedComments(expandableCommentsPosts);
  }

  // One unreadable post must not discard the whole batch, since the pending set
  // is already cleared by the time posts are parsed.
  private async capturePost(
    element: Element,
    group: GroupInfo,
  ): Promise<CapturedPost | null> {
    try {
      const draft = parsePost(element, group);
      const finalizedPost = await finalizeCapturedPost(
        draft,
        element,
        new Date().toISOString(),
      );
      const previousPost = this.observedPosts.get(element);

      if (previousPost === undefined) {
        return finalizedPost;
      }

      return retainCapturedIdentity(previousPost, finalizedPost);
    } catch (error) {
      console.warn('Skipped a post that could not be parsed:', toErrorMessage(error));
      return null;
    }
  }

  private emitCapturedPosts(posts: CapturedPost[]): void {
    for (let index = 0; index < posts.length; index += BATCH_SIZE) {
      const batch = posts.slice(index, index + BATCH_SIZE);
      this.callbacks.onPostsCaptured(batch);
    }
  }

  private expandTruncatedPosts(truncatedPosts: TruncatedPost[]): void {
    for (const truncatedPost of truncatedPosts) {
      // Comet swaps the story node on every re-render, so the click budget is
      // tracked per post identity to keep clicking bounded.
      const spentClicks =
        this.expansionClickCounts.get(truncatedPost.identityKey) ?? 0;
      const clickCount = clickPostTextExpansionControls(
        truncatedPost.element,
        MAX_EXPANSION_CLICKS_PER_POST - spentClicks,
      );

      if (clickCount > 0) {
        this.expansionClickCounts.set(
          truncatedPost.identityKey,
          spentClicks + clickCount,
        );
      }
    }
  }

  private expandCollapsedComments(expandablePosts: ExpandableCommentsPost[]): void {
    for (const expandablePost of expandablePosts) {
      const spentClicks =
        this.commentExpansionClickCounts.get(expandablePost.identityKey) ?? 0;
      const clickCount = clickCommentExpansionControls(
        expandablePost.element,
        MAX_COMMENT_EXPANSION_CLICKS_PER_POST - spentClicks,
      );

      if (clickCount > 0) {
        this.commentExpansionClickCounts.set(
          expandablePost.identityKey,
          spentClicks + clickCount,
        );
      }
    }
  }
}
