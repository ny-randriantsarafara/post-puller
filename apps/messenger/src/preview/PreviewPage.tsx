import { toErrorMessage } from '@extractor/capture-core/errorMessage';
import { resolvePageOffset } from '@extractor/capture-core/storage';
import {
  hasActiveFilters,
  PreviewFilterBar,
  WarningTally,
  type PreviewFilters,
} from '@extractor/capture-ui';
import { useCallback, useEffect, useState } from 'react';
import { downloadThreadExport } from '../shared/export/downloadExport';
import { messageRepository } from '../shared/storage/messageRepository';
import type { CapturedMessage } from '../shared/types/capturedMessage';
import type { CapturedThread } from '../shared/types/thread';

const PAGE_SIZE_OPTIONS = [50, 100, 200] as const;

const DEFAULT_FILTERS: PreviewFilters = {
  text: '',
  warning: null,
  pageSize: 50,
};

// Long enough that typing a word is one read of the conversation rather than one
// per letter, short enough that the list still feels attached to the keyboard.
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

// What a page of messages amounts to. An unfiltered read knows the length of the
// conversation it is paging; a filtered one knows only whether more follow.
type MessagesView = {
  readonly messages: CapturedMessage[];
  readonly total: number | null;
  readonly hasMore: boolean;
};

const EMPTY_VIEW: MessagesView = {
  messages: [],
  total: null,
  hasMore: false,
};

function formatSender(message: CapturedMessage): string {
  if (message.sender === null) {
    return 'Unknown sender';
  }

  if (message.sender.kind === 'self') {
    return 'You';
  }

  return message.sender.name;
}

// A message with no resolved date says so, rather than being shown under the day
// the capture happened to run.
function formatSentAt(message: CapturedMessage): string {
  if (message.sentAt === null) {
    return message.displayedAt ?? 'No date';
  }

  return new Date(message.sentAt).toLocaleString();
}

function formatReactions(message: CapturedMessage): string | null {
  if (message.reactions.length === 0) {
    return null;
  }

  return message.reactions
    .map((reaction) => `${reaction.emoji} ${String(reaction.count)}`)
    .join(' · ');
}

function formatAttachments(message: CapturedMessage): string | null {
  const attachments = message.attachments.filter(
    (attachment) => attachment.kind !== 'none',
  );
  if (attachments.length === 0) {
    return null;
  }

  return attachments
    .map((attachment) =>
      attachment.kind === 'file' ? `File: ${attachment.caption}` : 'Shared story',
    )
    .join(' · ');
}

function threadLabel(thread: CapturedThread): string {
  if (thread.title !== null && thread.title.trim().length > 0) {
    return thread.title;
  }

  return thread.threadId;
}

function formatRange(view: MessagesView, offset: number): string {
  if (view.messages.length === 0) {
    return 'Nothing on this page';
  }

  const firstShown = offset + 1;
  const lastShown = offset + view.messages.length;

  if (view.total === null) {
    return `Matches ${String(firstShown)}-${String(lastShown)}`;
  }

  return `Showing ${String(firstShown)}-${String(lastShown)} of ${String(view.total)}`;
}

export function PreviewPage() {
  const [threads, setThreads] = useState<CapturedThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [view, setView] = useState<MessagesView>(EMPTY_VIEW);
  const [warningCounts, setWarningCounts] = useState<ReadonlyMap<string, number>>(
    new Map(),
  );
  const [filters, setFilters] = useState<PreviewFilters>(DEFAULT_FILTERS);
  // The search box moves with the keyboard; this is what the conversation has
  // been asked about, which lags it by one debounce.
  const [appliedText, setAppliedText] = useState('');
  const [jumpDay, setJumpDay] = useState('');
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  // The conversations to choose from and the warning codes the filter offers.
  // Re-read after a conversation is deleted, which is the only thing this page
  // does that changes either of them.
  const loadSummaries = useCallback(async () => {
    try {
      const [storedThreads, counts] = await Promise.all([
        messageRepository.listThreads(),
        messageRepository.countMessagesByWarning(),
      ]);

      setThreads(storedThreads);
      setWarningCounts(counts);
      // A conversation just deleted leaves the selection pointing at nothing, so
      // it falls back to the first one still stored.
      setSelectedThreadId((current) => {
        const isStillStored = storedThreads.some(
          (thread) => thread.threadId === current,
        );
        if (isStillStored) {
          return current;
        }

        return storedThreads[0]?.threadId ?? null;
      });
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }, []);

  // One page of the selected conversation, as the filters describe it. Returns
  // the page instead of showing it, so the effect below can decide whether it is
  // still wanted.
  const readPage = useCallback(async (): Promise<MessagesView> => {
    if (selectedThreadId === null) {
      return EMPTY_VIEW;
    }

    if (isFiltered) {
      const page = await messageRepository.findThreadMessagesPage(
        selectedThreadId,
        { warning: appliedFilters.warning, text: appliedFilters.text },
        offset,
        appliedFilters.pageSize,
      );

      return { messages: page.messages, total: null, hasMore: page.hasMore };
    }

    const page = await messageRepository.listThreadMessagesPage(
      selectedThreadId,
      offset,
      appliedFilters.pageSize,
    );

    return {
      messages: page.messages,
      total: page.total,
      hasMore: offset + page.messages.length < page.total,
    };
  }, [
    appliedFilters.pageSize,
    appliedFilters.text,
    appliedFilters.warning,
    isFiltered,
    offset,
    selectedThreadId,
  ]);

  useEffect(() => {
    void loadSummaries();
  }, [loadSummaries]);

  // A read the reader has already moved on from must not land. Switching
  // conversation while a page is in flight starts a second read, and without
  // this the one that finishes last wins rather than the one that was asked for
  // last.
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

  const selectedThread =
    threads.find((thread) => thread.threadId === selectedThreadId) ?? null;

  // The day is turned into a position rather than a filter: the reader lands on
  // the page that day starts on and can keep paging from there.
  const handleJumpToDay = async (day: string) => {
    setJumpDay(day);

    if (day === '' || selectedThreadId === null) {
      return;
    }

    const messagesBefore = await messageRepository.countThreadMessagesBeforeDay(
      selectedThreadId,
      day,
    );
    setOffset(resolvePageOffset(messagesBefore, appliedFilters.pageSize, view.total));
  };

  const handleDeleteThread = async (thread: CapturedThread) => {
    const confirmed = window.confirm(
      `Delete the ${String(thread.messageCount)} captured messages of ${threadLabel(thread)}?`,
    );
    if (!confirmed) {
      return;
    }

    try {
      await messageRepository.deleteThread(thread.threadId);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
      return;
    }

    setOffset(0);
    setJumpDay('');
    await loadSummaries();
  };

  // Every filter change means the reader is looking for something else, so the
  // page they were on no longer refers to anything they asked for.
  const handleFiltersChange = (nextFilters: PreviewFilters) => {
    setFilters(nextFilters);
    setOffset(0);
  };

  return (
    <main className="preview">
      <header className="preview__header">
        <h1 className="preview__title">Captured conversations</h1>

        <label className="preview__control">
          <span>Conversation</span>
          <select
            value={selectedThreadId ?? ''}
            disabled={threads.length === 0}
            onChange={(event) => {
              setSelectedThreadId(event.target.value);
              setOffset(0);
              setJumpDay('');
            }}
          >
            {threads.map((thread) => (
              <option key={thread.threadId} value={thread.threadId}>
                {threadLabel(thread)} ({thread.messageCount})
              </option>
            ))}
          </select>
        </label>

        {selectedThread !== null && (
          <button
            type="button"
            className="cui-button cui-button--secondary"
            onClick={() => {
              void downloadThreadExport(selectedThread);
            }}
          >
            Export this conversation
          </button>
        )}

        {selectedThread !== null && (
          <button
            type="button"
            className="cui-button cui-button--danger"
            onClick={() => {
              void handleDeleteThread(selectedThread);
            }}
          >
            Delete this conversation
          </button>
        )}
      </header>

      {selectedThread !== null && (
        <p className="preview__summary">
          {selectedThread.messageCount} messages ·{' '}
          {selectedThread.reachedThreadStart
            ? 'read back to the first message'
            : 'partial history'}
          {selectedThread.unresolvedTimestampCount > 0 &&
            ` · ${String(selectedThread.unresolvedTimestampCount)} without a resolved date`}
          {selectedThread.isEncryptedThread && ' · end-to-end encrypted'}
        </p>
      )}

      <WarningTally
        warningCounts={warningCounts}
        caption="Warnings across every captured message:"
      />

      <PreviewFilterBar
        filters={filters}
        warningCounts={warningCounts}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        searchPlaceholder="A word in a message, or a sender's name"
        jumpDay={jumpDay}
        isJumpDisabled={isFiltered}
        onFiltersChange={handleFiltersChange}
        onJumpToDay={(day) => {
          void handleJumpToDay(day);
        }}
      />

      {errorMessage !== null && <p className="message__warnings">{errorMessage}</p>}

      {isLoading && <p className="preview__empty">Loading captured messages…</p>}

      {!isLoading && view.messages.length === 0 && (
        <p className="preview__empty">
          {isFiltered
            ? 'No captured message matches that.'
            : 'No captured messages yet.'}
        </p>
      )}

      <ol className="preview__messages">
        {!isLoading &&
          view.messages.map((message) => (
            <li className="message" key={message.identityKey}>
              <div className="message__meta">
                <span className="message__sender">{formatSender(message)}</span>
                <span className="message__date">{formatSentAt(message)}</span>
              </div>

              <p className="message__text">
                {message.isUnsent && <em>Unsent. </em>}
                {message.text ?? <em>No text</em>}
              </p>

              {formatReactions(message) !== null && (
                <p className="message__detail">{formatReactions(message)}</p>
              )}
              {formatAttachments(message) !== null && (
                <p className="message__detail">{formatAttachments(message)}</p>
              )}
              {message.warnings.length > 0 && (
                <p className="message__warnings">{message.warnings.join(', ')}</p>
              )}
            </li>
          ))}
      </ol>

      {/* Kept while the page is empty but the reader is not on the first one, so
          a page that has nothing on it still has a way back off it. */}
      {(view.messages.length > 0 || offset > 0) && (
        <footer className="preview__footer">
          <button
            type="button"
            className="cui-button cui-button--secondary"
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
            className="cui-button cui-button--secondary"
            disabled={!view.hasMore}
            onClick={() => {
              setOffset(offset + appliedFilters.pageSize);
            }}
          >
            Next
          </button>
        </footer>
      )}
    </main>
  );
}
