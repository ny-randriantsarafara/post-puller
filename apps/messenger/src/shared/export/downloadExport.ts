import { buildJsonRecordBlob, downloadBlob } from '@extractor/capture-core/export';
import { messageRepository } from '../storage/messageRepository';
import type { CapturedThread } from '../types/thread';
import {
  addMessagesToThreadExportSummary,
  buildThreadExportFileName,
  buildThreadExportHeader,
  EMPTY_THREAD_EXPORT_SUMMARY,
  type ThreadExportSummary,
} from './exportEnvelope';

// Large enough that a long conversation is not a thousand transactions, small
// enough that no page is a memory problem of its own.
const EXPORT_PAGE_SIZE = 500;

// The stats and the warnings describe the whole thread, and they are written at
// the top of the file, so the thread is read twice: once to count it and once to
// write it. Reading it twice costs a second pass over an index; holding it to
// avoid that costs the whole conversation in memory.
async function summarizeThread(threadId: string): Promise<ThreadExportSummary> {
  let summary = EMPTY_THREAD_EXPORT_SUMMARY;

  for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
    const page = await messageRepository.listThreadMessagesPage(
      threadId,
      offset,
      EXPORT_PAGE_SIZE,
    );
    summary = addMessagesToThreadExportSummary(summary, page.messages);

    if (page.messages.length < EXPORT_PAGE_SIZE) {
      return summary;
    }
  }
}

export async function downloadThreadExport(thread: CapturedThread): Promise<void> {
  const exportedAt = new Date().toISOString();
  const summary = await summarizeThread(thread.threadId);
  const header = buildThreadExportHeader(
    thread,
    summary,
    chrome.runtime.getManifest().version,
    exportedAt,
  );

  const blob = await buildJsonRecordBlob({
    header,
    recordsKey: 'messages',
    // Date order, which the index the page comes from already provides.
    readPage: async (offset, limit) =>
      (await messageRepository.listThreadMessagesPage(thread.threadId, offset, limit))
        .messages,
    pageSize: EXPORT_PAGE_SIZE,
  });

  downloadBlob(
    blob,
    buildThreadExportFileName(thread, summary.conversationWindow, exportedAt),
  );
}
