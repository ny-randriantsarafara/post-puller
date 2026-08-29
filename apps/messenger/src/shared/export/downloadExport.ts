import { messageRepository } from '../storage/messageRepository';
import type { CapturedThread } from '../types/thread';
import { buildThreadExport, serializeExportEnvelope } from './exportEnvelope';

export async function downloadThreadExport(thread: CapturedThread): Promise<void> {
  const page = await messageRepository.listThreadMessagesPage(
    thread.threadId,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const threadExport = buildThreadExport(
    thread,
    page.messages,
    chrome.runtime.getManifest().version,
    new Date().toISOString(),
  );

  const blob = new Blob([serializeExportEnvelope(threadExport.envelope)], {
    type: 'application/json',
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = threadExport.fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
