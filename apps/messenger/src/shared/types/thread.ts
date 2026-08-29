import type { ThreadIdSource } from '../../content/threadPage';

// Why a scan stopped, kept apart from whether it succeeded. Only the first two
// mean the thread was read all the way back to its first message.
export const SCAN_STOP_REASONS = [
  'threadStartMarker',
  'reachedStart',
  // Not at the top, yet nothing new loads. Reported as its own state because it
  // is actionable by the user, and reporting it as success would be a lie.
  'blocked',
  'stepCap',
  'timeCap',
  'userLimit',
  'interrupted',
] as const;

export type ScanStopReason = (typeof SCAN_STOP_REASONS)[number];

const COMPLETE_STOP_REASONS: readonly ScanStopReason[] = [
  'threadStartMarker',
  'reachedStart',
];

export function reachedThreadStart(stopReason: ScanStopReason): boolean {
  return COMPLETE_STOP_REASONS.includes(stopReason);
}

// The per-thread record that lives beside the messages. It is what lets a
// re-scan know where it left off, and what carries the honesty flags an export
// has to reproduce.
export type CapturedThread = {
  threadId: string;
  threadIdSource: ThreadIdSource;
  title: string | null;
  // Every id this thread has been reached under. The same conversation is
  // reachable by numeric id and by vanity handle, so a thread first stored under
  // the weaker one is recognised here and promoted rather than duplicated.
  aliases: string[];
  isEncryptedThread: boolean;
  messageCount: number;
  unresolvedTimestampCount: number;
  reachedThreadStart: boolean;
  lastStopReason: ScanStopReason | null;
  firstScannedAt: string;
  lastScannedAt: string;
  oldestSentAt: string | null;
  newestSentAt: string | null;
};
