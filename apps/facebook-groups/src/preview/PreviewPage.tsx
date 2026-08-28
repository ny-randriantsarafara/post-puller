import { useCallback, useEffect, useState } from 'react';
import { downloadCollectionExports } from '../shared/export/exportEnvelope';
import { listCollectionStats, listPostsPage } from '../shared/storage/postRepository';
import {
  formatPublicationWindow,
  type CollectionCaptureStats,
} from '../shared/stats/collectionStats';
import type { CapturedPost, ReactionBreakdown } from '../shared/types';
import { REACTION_TYPES, sumReactionBreakdown } from '../shared/types';

const PAGE_SIZE = 20;
const ALL_GROUPS = 'all';

function formatAuthor(post: CapturedPost): string {
  if (post.author.kind === 'named') {
    return post.author.name;
  }

  if (post.author.kind === 'anonymous') {
    return post.author.label;
  }

  return 'Unknown author';
}

function formatPublicationDate(post: CapturedPost): string {
  if (post.publishedAt !== null) {
    return new Date(post.publishedAt).toLocaleString();
  }

  return post.displayedDate ?? 'Unknown date';
}

function formatCollectionLabel(group: CollectionCaptureStats['collection']): string {
  if (group.name !== null && group.name.trim().length > 0) {
    return group.name;
  }

  const slug = group.url.split('/').filter(Boolean).pop();
  if (slug !== undefined) {
    return slug;
  }

  return 'Unknown group';
}

function formatReactionBreakdown(breakdown: ReactionBreakdown): string {
  const parts = REACTION_TYPES.flatMap((reactionType) => {
    const count = breakdown[reactionType];
    if (count === undefined) {
      return [];
    }

    return [`${reactionType} ${String(count)}`];
  });

  return parts.length > 0 ? parts.join(' · ') : 'No reaction breakdown';
}

function formatEngagementSummary(post: CapturedPost): string {
  const commentTotal = post.commentCount ?? post.comments.length;
  const shareTotal = post.shareCount;

  const parts: string[] = [];

  if (post.reactionCount !== null) {
    parts.push(`${String(post.reactionCount)} reactions`);
  }

  parts.push(`${String(commentTotal)} comments`);

  if (shareTotal !== null) {
    parts.push(`${String(shareTotal)} shares`);
  }

  return parts.join(' · ');
}

export function PreviewPage() {
  const [posts, setPosts] = useState<CapturedPost[]>([]);
  const [collectionStats, setGroupStats] = useState<CollectionCaptureStats[]>([]);
  const [selectedGroupUrl, setSelectedGroupUrl] = useState<string>(ALL_GROUPS);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadGroupStats = useCallback(async () => {
    const stats = await listCollectionStats();
    setGroupStats(stats);
  }, []);

  const loadPage = useCallback(async (pageOffset: number, collectionUrl: string | null) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const page = await listPostsPage(pageOffset, PAGE_SIZE, collectionUrl);
      setPosts(page.posts);
      setTotal(page.total);
      setOffset(page.offset);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load posts';
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGroupStats();
  }, [loadGroupStats]);

  useEffect(() => {
    const collectionUrl = selectedGroupUrl === ALL_GROUPS ? null : selectedGroupUrl;
    void loadPage(0, collectionUrl);
  }, [loadPage, selectedGroupUrl]);

  const handleExport = async () => {
    const allPostsPage = await listPostsPage(0, Number.MAX_SAFE_INTEGER);
    const postsToExport =
      selectedGroupUrl === ALL_GROUPS
        ? allPostsPage.posts
        : allPostsPage.posts.filter((post) => post.collection.url === selectedGroupUrl);

    downloadCollectionExports(
      postsToExport,
      chrome.runtime.getManifest().version,
      new Date().toISOString(),
    );
  };

  const canGoPrevious = offset > 0;
  const canGoNext = offset + PAGE_SIZE < total;
  const showGroupName = selectedGroupUrl === ALL_GROUPS;

  return (
    <main className="preview">
      <header className="preview__header">
        <h1 className="preview__title">Captured Posts Preview</h1>
        <div className="preview__actions">
          <button
            type="button"
            className="button button--secondary"
            disabled={total === 0 && collectionStats.length === 0}
            onClick={() => {
              void handleExport();
            }}
          >
            Export JSON
          </button>
        </div>
      </header>

      {collectionStats.length > 0 && (
        <section className="preview__summary">
          <h2 className="preview__summary-title">Captured by group</h2>
          <div className="preview__summary-grid">
            {collectionStats.map((collectionStat) => (
              <article className="preview__summary-card" key={collectionStat.collection.url}>
                <h3 className="preview__summary-name">{formatCollectionLabel(collectionStat.collection)}</h3>
                <p className="preview__summary-meta">
                  {collectionStat.postCount} posts · {collectionStat.incompletePostCount} incomplete ·{' '}
                  {formatPublicationWindow(collectionStat.publicationWindow)}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      {collectionStats.length > 0 && (
        <label className="preview__filter">
          <span className="preview__filter-label">Show posts from</span>
          <select
            className="preview__filter-select"
            value={selectedGroupUrl}
            onChange={(event) => {
              setSelectedGroupUrl(event.target.value);
            }}
          >
            <option value={ALL_GROUPS}>All groups</option>
            {collectionStats.map((collectionStat) => (
              <option key={collectionStat.collection.url} value={collectionStat.collection.url}>
                {formatCollectionLabel(collectionStat.collection)}
              </option>
            ))}
          </select>
        </label>
      )}

      {errorMessage !== null && <p className="post-card__warnings">{errorMessage}</p>}

      {isLoading && <div className="preview__empty">Loading captured posts…</div>}

      {!isLoading && total === 0 && (
        <div className="preview__empty">No captured posts yet.</div>
      )}

      {!isLoading &&
        posts.map((post) => (
          <article key={post.identityKey} className="post-card">
            <div className="post-card__meta">
              {showGroupName && (
                <span className="post-card__group">{formatCollectionLabel(post.collection)} · </span>
              )}
              {formatAuthor(post)} · {formatPublicationDate(post)}
              {post.displayedDate !== null && post.publishedAt !== null && (
                <span> ({post.displayedDate})</span>
              )}{' '}
              · {formatEngagementSummary(post)}
            </div>
            {sumReactionBreakdown(post.reactionBreakdown) > 0 && (
              <p className="post-card__reactions">
                {formatReactionBreakdown(post.reactionBreakdown)}
              </p>
            )}
            {post.externalUrl !== null && (
              <a
                className="post-card__link"
                href={post.externalUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open post on Facebook
              </a>
            )}
            <p>{post.text ?? '[No visible text]'}</p>
            {post.warnings.length > 0 && (
              <p className="post-card__warnings">Warnings: {post.warnings.join(', ')}</p>
            )}
            {post.comments.length > 0 && (
              <ul className="comment-list">
                {post.comments.map((comment, index) => (
                  <li
                    key={comment.commentId ?? `${post.identityKey}-comment-${String(index)}`}
                    className="comment-list__item"
                    style={{ marginLeft: `${String(comment.depth * 16)}px` }}
                  >
                    <strong>
                      {comment.author.kind === 'named'
                        ? comment.author.name
                        : comment.author.kind === 'anonymous'
                          ? comment.author.label
                          : 'Unknown'}
                    </strong>
                    : {comment.text ?? '[No visible text]'}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}

      {total > 0 && (
        <div className="preview__pagination">
          <button
            type="button"
            className="button button--secondary"
            disabled={!canGoPrevious}
            onClick={() => {
              const collectionUrl = selectedGroupUrl === ALL_GROUPS ? null : selectedGroupUrl;
              void loadPage(Math.max(offset - PAGE_SIZE, 0), collectionUrl);
            }}
          >
            Previous
          </button>
          <span>
            Showing {offset + 1}-{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <button
            type="button"
            className="button button--secondary"
            disabled={!canGoNext}
            onClick={() => {
              const collectionUrl = selectedGroupUrl === ALL_GROUPS ? null : selectedGroupUrl;
              void loadPage(offset + PAGE_SIZE, collectionUrl);
            }}
          >
            Next
          </button>
        </div>
      )}
    </main>
  );
}
