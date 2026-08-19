import { useCallback, useEffect, useState } from 'react';
import { downloadGroupExports } from '../shared/export/exportEnvelope';
import { listGroupStats, listPostsPage } from '../shared/storage/postRepository';
import {
  formatPublicationWindow,
  type GroupCaptureStats,
} from '../shared/stats/groupStats';
import type { CapturedPost } from '../shared/types';

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

function formatGroupLabel(group: GroupCaptureStats['group']): string {
  if (group.name !== null && group.name.trim().length > 0) {
    return group.name;
  }

  const slug = group.url.split('/').filter(Boolean).pop();
  if (slug !== undefined) {
    return slug;
  }

  return 'Unknown group';
}

export function PreviewPage() {
  const [posts, setPosts] = useState<CapturedPost[]>([]);
  const [groupStats, setGroupStats] = useState<GroupCaptureStats[]>([]);
  const [selectedGroupUrl, setSelectedGroupUrl] = useState<string>(ALL_GROUPS);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadGroupStats = useCallback(async () => {
    const stats = await listGroupStats();
    setGroupStats(stats);
  }, []);

  const loadPage = useCallback(async (pageOffset: number, groupUrl: string | null) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const page = await listPostsPage(pageOffset, PAGE_SIZE, groupUrl);
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
    const groupUrl = selectedGroupUrl === ALL_GROUPS ? null : selectedGroupUrl;
    void loadPage(0, groupUrl);
  }, [loadPage, selectedGroupUrl]);

  const handleExport = async () => {
    const allPostsPage = await listPostsPage(0, Number.MAX_SAFE_INTEGER);
    const postsToExport =
      selectedGroupUrl === ALL_GROUPS
        ? allPostsPage.posts
        : allPostsPage.posts.filter((post) => post.group.url === selectedGroupUrl);

    downloadGroupExports(
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
            disabled={total === 0 && groupStats.length === 0}
            onClick={() => {
              void handleExport();
            }}
          >
            Export JSON
          </button>
        </div>
      </header>

      {groupStats.length > 0 && (
        <section className="preview__summary">
          <h2 className="preview__summary-title">Captured by group</h2>
          <div className="preview__summary-grid">
            {groupStats.map((groupStat) => (
              <article className="preview__summary-card" key={groupStat.group.url}>
                <h3 className="preview__summary-name">{formatGroupLabel(groupStat.group)}</h3>
                <p className="preview__summary-meta">
                  {groupStat.postCount} posts · {groupStat.incompletePostCount} incomplete ·{' '}
                  {formatPublicationWindow(groupStat.publicationWindow)}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      {groupStats.length > 0 && (
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
            {groupStats.map((groupStat) => (
              <option key={groupStat.group.url} value={groupStat.group.url}>
                {formatGroupLabel(groupStat.group)}
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
                <span className="post-card__group">{formatGroupLabel(post.group)} · </span>
              )}
              {formatAuthor(post)} · {formatPublicationDate(post)}
              {post.displayedDate !== null && post.publishedAt !== null && (
                <span> ({post.displayedDate})</span>
              )}{' '}
              · {post.reactionCount ?? 0} reactions · {post.comments.length} comments
            </div>
            {post.postUrl !== null && (
              <a
                className="post-card__link"
                href={post.postUrl}
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
                  <li key={`${post.identityKey}-comment-${String(index)}`} className="comment-list__item">
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
              const groupUrl = selectedGroupUrl === ALL_GROUPS ? null : selectedGroupUrl;
              void loadPage(Math.max(offset - PAGE_SIZE, 0), groupUrl);
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
              const groupUrl = selectedGroupUrl === ALL_GROUPS ? null : selectedGroupUrl;
              void loadPage(offset + PAGE_SIZE, groupUrl);
            }}
          >
            Next
          </button>
        </div>
      )}
    </main>
  );
}
