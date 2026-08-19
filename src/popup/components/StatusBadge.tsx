import type { CaptureSession } from '../../shared/types';

type StatusBadgeProps = {
  session: CaptureSession;
};

function statusLabel(session: CaptureSession): string {
  if (session.status === 'capturing') {
    return 'Capturing';
  }

  if (session.status === 'interrupted') {
    return 'Interrupted';
  }

  return 'Idle';
}

function statusClassName(session: CaptureSession): string {
  if (session.status === 'capturing') {
    return 'popup__status-dot popup__status-dot--capturing';
  }

  if (session.status === 'interrupted') {
    return 'popup__status-dot popup__status-dot--interrupted';
  }

  return 'popup__status-dot';
}

export function StatusBadge({ session }: StatusBadgeProps) {
  return (
    <div className="popup__status">
      <span className={statusClassName(session)} />
      <span>{statusLabel(session)}</span>
    </div>
  );
}
