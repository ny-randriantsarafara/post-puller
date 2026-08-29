import type { CaptureStatus } from '@extractor/capture-core/messaging';

type StatusBadgeProps = {
  status: CaptureStatus;
  // What the site calls what it is doing. "Capturing" reads oddly for a scan
  // that walks a conversation backwards, so the word is the app's to choose.
  activeLabel?: string;
};

function statusLabel(status: CaptureStatus, activeLabel: string): string {
  switch (status) {
    case 'capturing':
      return activeLabel;
    case 'interrupted':
      return 'Interrupted';
    case 'idle':
      return 'Idle';
    default: {
      const unhandled: never = status;
      return String(unhandled);
    }
  }
}

export function StatusBadge({ status, activeLabel = 'Capturing' }: StatusBadgeProps) {
  return (
    <div className="cui-status">
      <span className={`cui-status__dot cui-status__dot--${status}`} />
      <span>{statusLabel(status, activeLabel)}</span>
    </div>
  );
}
