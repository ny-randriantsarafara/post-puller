import { useCallback, useEffect, useState } from 'react';
import {
  downloadCollectionExports,
} from '../shared/export/exportEnvelope';
import { listPostsPage } from '../shared/storage/postRepository';
import { trySendBackgroundRequest } from '../shared/messaging/client';
import type { BackgroundRequest } from '../shared/messaging/protocol';
import {
  findCollectionStats,
  sumCollectionStats,
} from '../shared/stats/collectionStats';
import type { CaptureMode, CaptureSession } from '../shared/types';
import { DEFAULT_CAPTURE_OPTIONS, type CaptureOptions } from '../shared/types';
import { EMPTY_CAPTURE_SESSION } from '../shared/types';
import { CaptureOptionsPanel } from './components/CaptureOptionsPanel';
import { CollectionStatsList } from './components/CollectionStatsList';
import { MetricCard } from './components/MetricCard';
import { ScanModeSelector } from './components/ScanModeSelector';
import { StatusBadge } from './components/StatusBadge';

function getActiveGroupLabel(session: CaptureSession): string {
  if (session.collectionName !== null && session.collectionName.trim().length > 0) {
    return session.collectionName;
  }

  if (session.collectionUrl !== null) {
    const slug = session.collectionUrl.split('/').filter(Boolean).pop();
    if (slug !== undefined) {
      return slug;
    }
  }

  return 'Current group';
}

function getStatusMessage(session: CaptureSession): string | null {
  if (session.status === 'interrupted') {
    return 'Capture was interrupted by navigation or refresh. Start again on the group page.';
  }

  const activeGroupStats = findCollectionStats(session.collectionStats, session.collectionUrl);
  const incompletePostCount =
    activeGroupStats?.incompleteItemCount ??
    sumCollectionStats(session.collectionStats).incompleteItemCount;

  if (incompletePostCount > 0) {
    return `${String(incompletePostCount)} captured posts may contain incomplete data.`;
  }

  return null;
}

function getAutoScrollMessage(session: CaptureSession): string | null {
  if (session.mode !== 'auto' || session.status !== 'capturing') {
    return null;
  }

  if (session.autoScrollCompletedAt !== null) {
    return 'Auto-scroll reached the end of the feed. Capture is still on, so stop it when you are done.';
  }

  return 'Auto-scrolling the group. Leave the tab open and visible.';
}

// A running session owns the mode, so reopening the popup mid-capture shows what
// is actually happening rather than the last radio button that was clicked.
function resolveSelectedMode(
  session: CaptureSession,
  requestedMode: CaptureMode,
): CaptureMode {
  if (session.status === 'capturing') {
    return session.mode;
  }

  return requestedMode;
}

function resolveSelectedOptions(
  session: CaptureSession,
  requestedOptions: CaptureOptions,
): CaptureOptions {
  if (session.status === 'capturing') {
    return session.options;
  }

  return requestedOptions;
}

async function queryActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (activeTab?.id === undefined) {
    return null;
  }

  return activeTab.id;
}

export function App() {
  const [session, setSession] = useState<CaptureSession>(EMPTY_CAPTURE_SESSION);
  const [requestedMode, setRequestedMode] = useState<CaptureMode>('manual');
  const [requestedOptions, setRequestedOptions] = useState<CaptureOptions>(
    DEFAULT_CAPTURE_OPTIONS,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refreshSession = useCallback(async () => {
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
  }, []);

  // Every command clears the busy state on its own failure path, so a broken
  // request can never leave the buttons disabled.
  const runSessionCommand = useCallback(async (request: BackgroundRequest) => {
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
  }, []);

  useEffect(() => {
    void refreshSession();
    const intervalId = window.setInterval(() => {
      void refreshSession();
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshSession]);

  const handleStartCapture = async () => {
    const tabId = await queryActiveTabId();
    if (tabId === null) {
      setErrorMessage('No active tab found.');
      return;
    }

    await runSessionCommand({
      type: 'START_CAPTURE',
      tabId,
      mode: requestedMode,
      options: requestedOptions,
    });
  };

  const handleStopCapture = async () => {
    await runSessionCommand({ type: 'STOP_CAPTURE' });
  };

  const handleClearData = async () => {
    const confirmed = window.confirm('Clear all captured posts from local storage?');
    if (!confirmed) {
      return;
    }

    await runSessionCommand({ type: 'CLEAR_DATA' });
  };

  const handleClearGroup = async (collectionUrl: string, collectionName: string | null) => {
    const label =
      collectionName !== null && collectionName.trim().length > 0 ? collectionName : 'this group';
    const confirmed = window.confirm(`Clear captured posts for ${label}?`);
    if (!confirmed) {
      return;
    }

    await runSessionCommand({ type: 'CLEAR_COLLECTION_DATA', collectionUrl });
  };

  const handleOpenPreview = () => {
    const previewUrl = chrome.runtime.getURL('src/preview/index.html');
    void chrome.tabs.create({ url: previewUrl });
  };

  const handleExportJson = async () => {
    const allPostsPage = await listPostsPage(0, Number.MAX_SAFE_INTEGER);
    downloadCollectionExports(
      allPostsPage.posts,
      chrome.runtime.getManifest().version,
      new Date().toISOString(),
    );
  };

  const statusMessage = getStatusMessage(session);
  const autoScrollMessage = getAutoScrollMessage(session);
  const isCapturing = session.status === 'capturing';
  const selectedMode = resolveSelectedMode(session, requestedMode);
  const selectedOptions = resolveSelectedOptions(session, requestedOptions);
  const totals = sumCollectionStats(session.collectionStats);
  const activeGroupStats = findCollectionStats(session.collectionStats, session.collectionUrl);
  const activeGroupLabel = getActiveGroupLabel(session);
  const activePostCount = activeGroupStats?.itemCount ?? 0;
  const activeIncompleteCount = activeGroupStats?.incompleteItemCount ?? 0;

  return (
    <main className="popup">
      <h1 className="popup__title">Facebook Group Capture</h1>
      <StatusBadge session={session} />

      <div className="popup__metrics">
        <MetricCard
          label={`Captured posts (${activeGroupLabel})`}
          value={activePostCount}
        />
        <MetricCard
          label={`Incomplete (${activeGroupLabel})`}
          value={activeIncompleteCount}
        />
      </div>

      <CollectionStatsList
        collectionStats={session.collectionStats}
        isBusy={isBusy}
        onClearCollection={(collectionUrl, collectionName) => {
          void handleClearGroup(collectionUrl, collectionName);
        }}
      />

      <ScanModeSelector
        mode={selectedMode}
        isDisabled={isBusy || isCapturing}
        onModeChange={setRequestedMode}
      />

      <CaptureOptionsPanel
        options={selectedOptions}
        isDisabled={isBusy || isCapturing}
        onOptionsChange={setRequestedOptions}
      />

      {autoScrollMessage !== null && (
        <p className="popup__message">{autoScrollMessage}</p>
      )}

      {statusMessage !== null && (
        <p className="popup__message popup__message--warning">{statusMessage}</p>
      )}

      {errorMessage !== null && (
        <p className="popup__message popup__message--error">{errorMessage}</p>
      )}

      <div className="popup__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={isBusy || isCapturing}
          onClick={() => {
            void handleStartCapture();
          }}
        >
          Start capture
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled={isBusy || !isCapturing}
          onClick={() => {
            void handleStopCapture();
          }}
        >
          Stop capture
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled={totals.itemCount === 0}
          onClick={handleOpenPreview}
        >
          Preview results
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled={totals.itemCount === 0}
          onClick={() => {
            void handleExportJson();
          }}
        >
          Export JSON
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={isBusy || totals.itemCount === 0}
          onClick={() => {
            void handleClearData();
          }}
        >
          Clear all data
        </button>
      </div>
    </main>
  );
}
