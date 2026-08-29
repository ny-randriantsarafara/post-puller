import {
  threadRequestSchema,
  type ThreadRequest,
  type ThreadResponse,
} from '../shared/messaging/threadRequests';
import { messageRepository } from '../shared/storage/messageRepository';
import { resolveThreadIdSource, type ScanStopReason } from '../shared/types/thread';

// Returns null when the message is not one of Messenger's own, so the caller can
// pass it to the generic coordinator instead.
export function parseThreadRequest(message: unknown): ThreadRequest | null {
  const parsed = threadRequestSchema.safeParse(message);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

export async function recordThreadScan(input: {
  threadId: string;
  aliases?: readonly string[];
  title?: string | null;
  isEncryptedThread?: boolean;
  stopReason: ScanStopReason | null;
}): Promise<void> {
  await messageRepository.recordThreadScan({
    threadId: input.threadId,
    threadIdSource: resolveThreadIdSource(input.threadId),
    aliases: input.aliases ?? [],
    title: input.title ?? null,
    isEncryptedThread: input.isEncryptedThread ?? false,
    stopReason: input.stopReason,
    scannedAt: new Date().toISOString(),
  });
}

export async function handleThreadRequest(
  request: ThreadRequest,
): Promise<ThreadResponse> {
  switch (request.type) {
    case 'RESOLVE_CANONICAL_THREAD_ID': {
      const threadId = await messageRepository.resolveCanonicalThreadId(
        request.candidateIds,
      );
      return { type: 'CANONICAL_THREAD_ID', threadId };
    }

    case 'RECORD_THREAD_SCAN': {
      const thread = await messageRepository.recordThreadScan({
        threadId: request.threadId,
        threadIdSource: resolveThreadIdSource(request.threadId),
        aliases: request.aliases,
        title: request.title,
        isEncryptedThread: request.isEncryptedThread,
        stopReason: request.stopReason,
        scannedAt: new Date().toISOString(),
      });
      return { type: 'THREAD_RECORDED', thread };
    }

    default: {
      const unhandled: never = request;
      return {
        type: 'ERROR',
        message: `Unhandled thread request: ${String(unhandled)}`,
      };
    }
  }
}
