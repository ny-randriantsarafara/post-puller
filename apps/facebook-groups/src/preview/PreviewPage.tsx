import {
  hasActiveFilters,
  PreviewFilterBar,
  WarningTally,
  type PreviewFilters,
} from '@extractor/capture-ui';
import { toErrorMessage } from '@extractor/capture-core/errorMessage';
import { resolvePageOffset } from '@extractor/capture-core/storage';
import { useCallback, useEffect, useState } from 'react';
import { downloadCollectionExports } from '../shared/export/downloadExport';
import {
  countPostsBeforeDay,
  countPostsByWarning,
  findPostsPage,
  listCollectionStats,
  listPostsPage,
  POST_ORDERS,
  type PostOrderName,
} from '../shared/storage/postRepository';
import {
  formatPublicationWindow,
  type CollectionCaptureStats,
} from '../shared/stats/collectionStats';
import type { CapturedPost, ReactionBreakdown } from '../shared/types';
import {
  formatAuthorLabel,
  REACTION_TYPES,
  sumReactionBreakdown,
} from '../shared/types';

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const ALL_GROUPS = 'all';

const DEFAULT_FILTERS: PreviewFilters = {
  text: '',
  warning: null,
  pageSize: 20,
};

// Long enough that typing a word is one read of the store rather than one per
// letter, short enough that the list still feels attached to the keyboard.
const SEARCH_DEBOUNCE_MS = 250;

// An emptied search box is applied at once: waiting to stop filtering is waiting
// for nothing, and a Clear button that has already gone leaves nothing to
// explain why the list is still narrowed.
function resolveSearchDelay(text: string): number {
  if (text === '') {
    return 0;
  }

  return SEARCH_DEBOUNCE_MS;
}

const ORDER_LABELS: Record<PostOrderName, string> = {
  newestPublication: 'Newest published first',
  oldestPublication: 'Oldest published first',
  newestCapture: 'Most recently captured first',
};

// What a page of posts amounts to. An unfiltered read knows the size of the
// group it is paging; a filtered one knows only whether more matches follow.
type PostsView = {
  readonly posts: CapturedPost[];
  readonly total: number | null;
  readonly hasMore: boolean;
};

const EMPTY_VIEW: PostsView = {
  posts: [],
  total: null,
  hasMore: false,
};

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

function formatRange(view: PostsView, offset: number): string {
  if (view.posts.length === 0) {
    return 'Nothing on this page';
  }

  const firstShown = offset + 1;
  const lastShown = offset + view.posts.length;

  if (view.total === null) {
    return `Matches ${String(firstShown)}-${String(lastShown)}`;
  }

  return `Showing ${String(firstShown)}-${String(lastShown)} of ${String(view.total)}`;
}

export function PreviewPage() {
  const [view, setView] = useState<PostsView>(EMPTY_VIEW);
  const [collectionStats, setCollectionStats] = useState<CollectionCaptureStats[]>([]);
  const [warningCounts, setWarningCounts] = useState<ReadonlyMap<string, number>>(
    new Map(),
  );
  const [selectedGroupUrl, setSelectedGroupUrl] = useState<string>(ALL_GROUPS);
  const [orderName, setOrderName] = useState<PostOrderName>('newestPublication');
  const [filters, setFilters] = useState<PreviewFilters>(DEFAULT_FILTERS);
  // The search box moves with the keyboard; this is what the store has been
  // asked about, which lags it by one debounce.
  const [appliedText, setAppliedText] = useState('');
  const [jumpDay, setJumpDay] = useState('');
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const collectionUrl = selectedGroupUrl === ALL_GROUPS ? null : selectedGroupUrl;
  const appliedFilters: PreviewFilters = { ...filters, text: appliedText };
  const isFiltered = hasActiveFilters(appliedFilters);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedText(filters.text);
    }, resolveSearchDelay(filters.text));

    return () => {
      clearTimeout(timer);
    };
  }, [filters.text]);

  // The group cards and the warning codes the filter offers. Read once beside the
  // first page rather than per page: they describe the whole store, and neither
  // changes as the reader pages through it.
  const loadSummaries = useCallback(async () => {
    try {
      const [stats, counts] = await Promise.all([
        listCollectionStats(),
        countPostsByWarning(),
      ]);
      setCollectionStats(stats);
      setWarningCounts(counts);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }, []);

  // One page, as the filters and the order describe it. Returns the page instead
  // of showing it, so the effect below can decide whether it is still wanted.
  const readPage = useCallback(async (): Promise<PostsView> => {
    if (isFiltered) {
      const page = await findPostsPage(
        orderName,
        { warning: appliedFilters.warning, text: appliedFilters.text },
        offset,
        appliedFilters.pageSize,
        collectionUrl,
      );

      return { posts: page.posts, total: null, hasMore: page.hasMore };
    }

    const page = await listPostsPage(
      orderName,
      offset,
      appliedFilters.pageSize,
      collectionUrl,
    );

    return {
      posts: page.posts,
      total: page.total,
      hasMore: offset + page.posts.length < page.total,
    };
  }, [
    appliedFilters.pageSize,
    appliedFilters.text,
    appliedFilters.warning,
    collectionUrl,
    isFiltered,
    offset,
    orderName,
  ]);

  useEffect(() => {
    void loadSummaries();
  }, [loadSummaries]);

  // A read the reader has already moved on from must not land. Switching group
  // while a page is in flight starts a second read, and without this the one
  // that finishes last wins rather than the one that was asked for last.
  useEffect(() => {
    const read = new AbortController();
    setIsLoading(true);
    setErrorMessage(null);

    const showPage = async () => {
      try {
        const nextView = await readPage();
        if (read.signal.aborted) {
          return;
        }

        setView(nextView);
      } catch (error) {
        if (read.signal.aborted) {
          return;
        }

        setErrorMessage(toErrorMessage(error));
        setView(EMPTY_VIEW);
      } finally {
        if (!read.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void showPage();

    return () => {
      read.abort();
    };
  }, [readPage]);

  // Driven by the group summaries the page already loaded, so exporting reads each
  // group's posts a page at a time rather than the whole store at once.
  const handleExport = async () => {
    const collectionsToExport = collectionStats
      .map((stats) => stats.collection)
      .filter(
        (collection) =>
          selectedGroupUrl === ALL_GROUPS || collection.url === selectedGroupUrl,
      );

    await downloadCollectionExports(
      collectionsToExport,
      chrome.runtime.getManifest().version,
      new Date().toISOString(),
    );
  };

  // The day is turned into a position rather than a filter: the reader lands on
  // the page that day starts on and can keep paging from there.
  const handleJumpToDay = async (day: string) => {
    setJumpDay(day);

    if (day === '') {
      return;
    }

    const postsBefore = await countPostsBeforeDay(orderName, day, collectionUrl);
    setOffset(resolvePageOffset(postsBefore, appliedFilters.pageSize, view.total));
  };

  // Every filter change means the reader is looking for something else, so the
  // page they were on no longer refers to anything they asked for.
  const handleFiltersChange = (nextFilters: PreviewFilters) => {
    setFilters(nextFilters);
    setOffset(0);
  };

  const showGroupName = selectedGroupUrl === ALL_GROUPS;

  return (
    <main className="preview">
      <header className="preview__header">
        <h1 className="preview__title">Captured Posts Preview</h1>
        <div className="preview__actions">
          <button
            type="button"
            className="button button--secondary"
            disabled={collectionStats.length === 0}
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
                  {collectionStat.itemCount} posts · {collectionStat.incompleteItemCount} incomplete ·{' '}
                  {formatPublicationWindow(collectionStat.publicationWindow)}
                </p>
              </article>
            ))}
          </div>
          <WarningTally
            warningCounts={warningCounts}
            caption="Warnings across every captured post:"
          />
        </section>
      )}

      <div className="preview__controls">
        {collectionStats.length > 0 && (
          <label className="preview__filter">
            <span className="preview__filter-label">Show posts from</span>
            <select
              className="preview__filter-select"
              value={selectedGroupUrl}
              onChange={(event) => {
                setSelectedGroupUrl(event.target.value);
                setOffset(0);
                setJumpDay('');
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

        <label className="preview__filter">
          <span className="preview__filter-label">Order</span>
          <select
            className="preview__filter-select"
            value={orderName}
            onChange={(event) => {
              const nextOrder = POST_ORDERS.find((order) => order === event.target.value);
              if (nextOrder === undefined) {
                return;
              }

              setOrderName(nextOrder);
              setOffset(0);
              // The date positioned the list in the order that was in force when
              // it was picked, and no longer does.
              setJumpDay('');
            }}
          >
            {POST_ORDERS.map((order) => (
              <option key={order} value={order}>
                {ORDER_LABELS[order]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <PreviewFilterBar
        filters={filters}
        warningCounts={warningCounts}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        searchPlaceholder="Text, author, or a word in the comments"
        jumpDay={jumpDay}
        isJumpDisabled={isFiltered}
        onFiltersChange={handleFiltersChange}
        onJumpToDay={(day) => {
          void handleJumpToDay(day);
        }}
      />

      {errorMessage !== null && <p className="post-card__warnings">{errorMessage}</p>}

      {isLoading && <div className="preview__empty">Loading captured posts…</div>}

      {!isLoading && view.posts.length === 0 && (
        <div className="preview__empty">
          {isFiltered ? 'No captured post matches that.' : 'No captured posts yet.'}
        </div>
      )}

      {!isLoading &&
        view.posts.map((post) => (
          <article key={post.identityKey} className="post-card">
            <div className="post-card__meta">
              {showGroupName && (
                <span className="post-card__group">{formatCollectionLabel(post.collection)} · </span>
              )}
              {formatAuthorLabel(post.author)} · {formatPublicationDate(post)}
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
                    <strong>{formatAuthorLabel(comment.author)}</strong>
                    : {comment.text ?? '[No visible text]'}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}

      {/* Kept while the page is empty but the reader is not on the first one, so
          a page that has nothing on it still has a way back off it. */}
      {(view.posts.length > 0 || offset > 0) && (
        <div className="preview__pagination">
          <button
            type="button"
            className="button button--secondary"
            disabled={offset === 0}
            onClick={() => {
              setOffset(Math.max(offset - appliedFilters.pageSize, 0));
            }}
          >
            Previous
          </button>
          <span>{formatRange(view, offset)}</span>
          <button
            type="button"
            className="button button--secondary"
            disabled={!view.hasMore}
            onClick={() => {
              setOffset(offset + appliedFilters.pageSize);
            }}
          >
            Next
          </button>
        </div>
      )}
    </main>
  );
}
