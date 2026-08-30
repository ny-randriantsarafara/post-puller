import type { CollectionInfo } from '@extractor/capture-core/domain';
import { buildJsonRecordBlob, downloadBlob } from '@extractor/capture-core/export';
import { listPostsPage, type PostOrderName } from '../storage/postRepository';
import {
  addPostsToCollectionExportSummary,
  buildCollectionExportFileName,
  buildCollectionExportHeader,
  EMPTY_COLLECTION_EXPORT_SUMMARY,
  type CollectionExportSummary,
} from './exportEnvelope';

// Large enough that a large group is not a thousand transactions, small enough
// that no page is a memory problem of its own.
const EXPORT_PAGE_SIZE = 200;

// A file lists its posts in the order they were published, which is the order
// somebody reading the export wants them in. Deliberately not whatever the
// preview happens to be sorted by when the button is pressed. Posts whose date
// never parsed sort ahead of the dated ones and so head the file, together,
// rather than being scattered through it under the date they were captured on.
const EXPORT_ORDER: PostOrderName = 'oldestPublication';

// The stats and the window describe the whole group and are written at the top of
// the file, so the group is read twice: once to count it and once to write it.
// Reading it twice costs a second pass over an index; holding it to avoid that
// costs every post in memory, on top of the file built from them.
async function summarizeCollection(
  collectionUrl: string,
): Promise<CollectionExportSummary> {
  let summary = EMPTY_COLLECTION_EXPORT_SUMMARY;

  for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
    const page = await listPostsPage(
      EXPORT_ORDER,
      offset,
      EXPORT_PAGE_SIZE,
      collectionUrl,
    );
    summary = addPostsToCollectionExportSummary(summary, page.posts);

    if (page.posts.length < EXPORT_PAGE_SIZE) {
      return summary;
    }
  }
}

export async function downloadCollectionExport(
  collection: CollectionInfo,
  extensionVersion: string,
  exportedAt: string,
): Promise<void> {
  const summary = await summarizeCollection(collection.url);
  const blob = await buildJsonRecordBlob({
    header: buildCollectionExportHeader(
      collection,
      summary,
      extensionVersion,
      exportedAt,
    ),
    recordsKey: 'posts',
    readPage: async (offset, limit) =>
      (await listPostsPage(EXPORT_ORDER, offset, limit, collection.url)).posts,
    pageSize: EXPORT_PAGE_SIZE,
  });

  downloadBlob(
    blob,
    buildCollectionExportFileName(collection, summary.publicationWindow, exportedAt),
  );
}

// One file per group, written one after another rather than all at once: two
// large groups held together are the problem this avoids for one.
export async function downloadCollectionExports(
  collections: readonly CollectionInfo[],
  extensionVersion: string,
  exportedAt: string,
): Promise<void> {
  for (const collection of collections) {
    await downloadCollectionExport(collection, extensionVersion, exportedAt);
  }
}
