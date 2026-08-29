import { useCallback, useEffect, useState } from 'react';
import { downloadThreadExport } from '../shared/export/downloadExport';
import { messageRepository } from '../shared/storage/messageRepository';
import type { CapturedMessage } from '../shared/types/capturedMessage';
import type { CapturedThread } from '../shared/types/thread';

const PAGE_SIZE = 50;

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

export function PreviewPage() {
  const [threads, setThreads] = useState<CapturedThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CapturedMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);

  useEffect(() => {
    void (async () => {
      const storedThreads = await messageRepository.listThreads();
      setThreads(storedThreads);
      setSelectedThreadId((current) => current ?? storedThreads[0]?.threadId ?? null);
    })();
  }, []);

  const loadPage = useCallback(async () => {
    if (selectedThreadId === null) {
      setMessages([]);
      setTotal(0);
      return;
    }

    const messagePage = await messageRepository.listThreadMessagesPage(
      selectedThreadId,
      page * PAGE_SIZE,
      PAGE_SIZE,
    );
    setMessages(messagePage.messages);
    setTotal(messagePage.total);
  }, [selectedThreadId, page]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const selectedThread =
    threads.find((thread) => thread.threadId === selectedThreadId) ?? null;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="preview">
      <header className="preview__header">
        <h1 className="preview__title">Captured conversations</h1>

        <label className="preview__control">
          <span>Conversation</span>
          <select
            value={selectedThreadId ?? ''}
            onChange={(event) => {
              setSelectedThreadId(event.target.value);
              setPage(0);
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

      <ol className="preview__messages">
        {messages.map((message) => (
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

      <footer className="preview__footer">
        <button
          type="button"
          className="cui-button cui-button--secondary"
          disabled={page === 0}
          onClick={() => {
            setPage((current) => Math.max(0, current - 1));
          }}
        >
          Previous
        </button>
        <span>
          Page {page + 1} of {pageCount}
        </span>
        <button
          type="button"
          className="cui-button cui-button--secondary"
          disabled={page + 1 >= pageCount}
          onClick={() => {
            setPage((current) => current + 1);
          }}
        >
          Next
        </button>
      </footer>
    </main>
  );
}
