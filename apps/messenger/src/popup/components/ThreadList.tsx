import type { CapturedThread } from '../../shared/types/thread';

type ThreadListProps = {
  threads: readonly CapturedThread[];
  isBusy: boolean;
  onExportThread: (thread: CapturedThread) => void;
};

function threadLabel(thread: CapturedThread): string {
  if (thread.title !== null && thread.title.trim().length > 0) {
    return thread.title;
  }

  return thread.threadId;
}

// Whether the conversation was read all the way back, said in the list rather
// than only in the export, so a partial scan is visible before anybody exports it.
function completenessLabel(thread: CapturedThread): string {
  if (thread.reachedThreadStart) {
    return 'complete';
  }

  if (thread.lastStopReason === 'blocked') {
    return 'blocked';
  }

  return 'partial';
}

export function ThreadList({ threads, isBusy, onExportThread }: ThreadListProps) {
  if (threads.length === 0) {
    return null;
  }

  return (
    <ul className="thread-list">
      {threads.map((thread) => (
        <li className="thread-list__item" key={thread.threadId}>
          <div className="thread-list__text">
            <span className="thread-list__title">{threadLabel(thread)}</span>
            <span className="thread-list__meta">
              {thread.messageCount} messages · {completenessLabel(thread)}
              {thread.isEncryptedThread ? ' · encrypted' : ''}
            </span>
          </div>
          <button
            type="button"
            className="cui-button cui-button--secondary"
            disabled={isBusy || thread.messageCount === 0}
            onClick={() => {
              onExportThread(thread);
            }}
          >
            Export
          </button>
        </li>
      ))}
    </ul>
  );
}
