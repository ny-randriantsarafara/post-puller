import {
  CaptureOptionsPanel,
  MetricCard,
  ScanModeSelector,
  StatusBadge,
  type CaptureOptionRow,
  type ScanModeOption,
} from '@extractor/capture-ui';
import { useCallback, useEffect, useState } from 'react';
import { trySendBackgroundRequest } from '../shared/messaging/client';
import type { BackgroundRequest } from '../shared/messaging/protocol';
import { messageRepository } from '../shared/storage/messageRepository';
import type { CaptureMode, CaptureSession } from '../shared/types/session';
import { EMPTY_CAPTURE_SESSION } from '../shared/types/session';
import { DEFAULT_SCAN_OPTIONS, type ScanOptions } from '../shared/types/scanOptions';
import type { CapturedThread } from '../shared/types/thread';
import { downloadThreadExport } from '../shared/export/downloadExport';
import { ThreadList } from './components/ThreadList';

const SCAN_MODE_OPTIONS: readonly ScanModeOption[] = [
  {
    value: 'manual',
    label: 'Manual scan',
    hint: 'You scroll the conversation yourself.',
  },
  {
    value: 'auto',
    label: 'Automatic scan',
    hint: 'The conversation scrolls itself upward until it reaches the start.',
  },
];

const SCAN_OPTION_ROWS: readonly CaptureOptionRow<ScanOptions>[] = [
  {
    kind: 'toggle',
    key: 'captureReactions',
    label: 'Capture reactions',
    hint: 'Stores the emoji and count read from each reaction pill.',
  },
  {
    kind: 'toggle',
    key: 'captureAttachments',
    label: 'Capture attachment details',
    hint: 'Metadata only. Files are never downloaded.',
  },
  {
    kind: 'number',
    key: 'stopAtMessageLimit',
    label: 'Stop after',
    hint: 'Messages. Leave empty to read the whole conversation.',
    min: 1,
    placeholder: 'no limit',
  },
  {
    kind: 'date',
    key: 'stopAtDate',
    label: 'Stop at',
    hint: 'Scrolling stops once a message older than this day is reached.',
  },
];

function resolveThreadLabel(session: CaptureSession): string {
  if (session.collectionName !== null && session.collectionName.trim().length > 0) {
    return session.collectionName;
  }

  if (session.collectionUrl !== null) {
    const threadId = session.collectionUrl.split('/').filter(Boolean).pop();
    if (threadId !== undefined) {
      return threadId;
    }
  }

  return 'Current conversation';
}

function resolveScanMessage(session: CaptureSession): string | null {
  if (session.mode !== 'auto' || session.status !== 'capturing') {
    return null;
  }

  if (session.autoScrollCompletedAt !== null) {
    return 'Scrolling reached the start of the conversation. Capture is still on, so stop it when you are done.';
  }

  return 'Scrolling the conversation upward. Leave the tab open and visible.';
}

// The session reports the conversation by the id in the URL, while its records are
// keyed under the id it was first captured under. Matching on the aliases is what
// makes the popup recognise a conversation reached by its other handle.
function findThreadOfSession(
  threads: readonly CapturedThread[],
  collectionUrl: string | null,
): CapturedThread | null {
  if (collectionUrl === null) {
    return null;
  }

  const match = threads.find((thread) =>
    [thread.threadId, ...thread.aliases].some((threadId) =>
      collectionUrl.endsWith(`/t/${threadId}`),
    ),
  );

  return match ?? null;
}

async function queryActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? null;
}

export function App() {
  const [session, setSession] = useState<CaptureSession>(EMPTY_CAPTURE_SESSION);
  const [threads, setThreads] = useState<CapturedThread[]>([]);
  const [requestedMode, setRequestedMode] = useState<CaptureMode>('auto');
  const [requestedOptions, setRequestedOptions] =
    useState<ScanOptions>(DEFAULT_SCAN_OPTIONS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refresh = useCallback(async () => {
    const result = await trySendBackgroundRequest({ type: 'GET_SESSION' });
    if (!result.ok) {
      setErrorMessage(result.error);
      return;
    }

    if (result.value.type === 'ERROR') {
      setErrorMessage(result.value.message);
      return;
    }

    setSession(result.value.session);
    setThreads(await messageRepository.listThreads());
  }, []);

  // Every command clears the busy state on its own failure path, so a broken
  // request can never leave the buttons disabled.
  const runCommand = useCallback(
    async (request: BackgroundRequest) => {
      setIsBusy(true);
      setErrorMessage(null);

      const result = await trySendBackgroundRequest(request);
      setIsBusy(false);

      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      if (result.value.type === 'ERROR') {
        setErrorMessage(result.value.message);
        return;
      }

      setSession(result.value.session);
      setThreads(await messageRepository.listThreads());
    },
    [],
  );

  useEffect(() => {
    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refresh]);

  const handleStartScan = async () => {
    const tabId = await queryActiveTabId();
    if (tabId === null) {
      setErrorMessage('No active tab found.');
      return;
    }

    await runCommand({
      type: 'START_CAPTURE',
      tabId,
      mode: requestedMode,
      options: requestedOptions,
    });
  };

  const handleClearAll = async () => {
    const confirmed = window.confirm(
      'Clear every captured message and conversation from local storage?',
    );
    if (!confirmed) {
      return;
    }

    await runCommand({ type: 'CLEAR_DATA' });
    await messageRepository.clearThreads();
    setThreads([]);
  };

  const isScanning = session.status === 'capturing';
  const selectedMode = isScanning ? session.mode : requestedMode;
  const selectedOptions = isScanning ? session.options : requestedOptions;
  const scanMessage = resolveScanMessage(session);
  const threadLabel = resolveThreadLabel(session);
  const activeThread = findThreadOfSession(threads, session.collectionUrl);
  const totalMessageCount = threads.reduce(
    (total, thread) => total + thread.messageCount,
    0,
  );

  return (
    <main className="cui-panel">
      <h1 className="cui-panel__title">Messenger Capture</h1>
      <StatusBadge status={session.status} activeLabel="Scanning" />

      <div className="cui-metrics">
        <MetricCard
          label={`Messages (${threadLabel})`}
          value={activeThread?.messageCount ?? 0}
        />
        <MetricCard label="Messages (all conversations)" value={totalMessageCount} />
      </div>

      {activeThread !== null && activeThread.isEncryptedThread && (
        <p className="cui-message cui-message--warning">
          This is an end-to-end encrypted conversation. Its content is in the page,
          so it will be captured and exported.
        </p>
      )}

      {activeThread !== null && !activeThread.reachedThreadStart && (
        <p className="cui-message cui-message--warning">
          This conversation has not been read back to its first message, so an
          export of it is partial.
        </p>
      )}

      {activeThread !== null && activeThread.lastStopReason === 'blocked' && (
        <p className="cui-message cui-message--warning">
          The last scan stopped before the start of the conversation and nothing
          more would load. Scroll it by hand for a moment, then scan again.
        </p>
      )}

      {activeThread !== null && activeThread.unresolvedTimestampCount > 0 && (
        <p className="cui-message cui-message--warning">
          {activeThread.unresolvedTimestampCount} messages have no resolved date.
        </p>
      )}

      <ScanModeSelector
        mode={selectedMode}
        options={SCAN_MODE_OPTIONS}
        isDisabled={isBusy || isScanning}
        onModeChange={setRequestedMode}
      />

      <CaptureOptionsPanel
        legend="Scan options"
        options={selectedOptions}
        rows={SCAN_OPTION_ROWS}
        isDisabled={isBusy || isScanning}
        onOptionsChange={setRequestedOptions}
      />

      <div className="cui-messages">
        {scanMessage !== null && <p className="cui-message">{scanMessage}</p>}
        {session.status === 'interrupted' && (
          <p className="cui-message cui-message--warning">
            The scan was interrupted by navigation or a refresh. Start again on the
            conversation.
          </p>
        )}
        {errorMessage !== null && (
          <p className="cui-message cui-message--error">{errorMessage}</p>
        )}
      </div>

      <ThreadList
        threads={threads}
        isBusy={isBusy}
        onExportThread={(thread) => {
          void downloadThreadExport(thread);
        }}
      />

      <div className="cui-actions">
        <button
          type="button"
          className="cui-button cui-button--primary"
          disabled={isBusy || isScanning}
          onClick={() => {
            void handleStartScan();
          }}
        >
          Start scan
        </button>
        <button
          type="button"
          className="cui-button cui-button--secondary"
          disabled={isBusy || !isScanning}
          onClick={() => {
            void runCommand({ type: 'STOP_CAPTURE' });
          }}
        >
          Stop scan
        </button>
        <button
          type="button"
          className="cui-button cui-button--secondary"
          disabled={totalMessageCount === 0}
          onClick={() => {
            void chrome.tabs.create({
              url: chrome.runtime.getURL('src/preview/index.html'),
            });
          }}
        >
          Preview messages
        </button>
        <button
          type="button"
          className="cui-button cui-button--danger"
          disabled={isBusy || totalMessageCount === 0}
          onClick={() => {
            void handleClearAll();
          }}
        >
          Clear all data
        </button>
      </div>
    </main>
  );
}
