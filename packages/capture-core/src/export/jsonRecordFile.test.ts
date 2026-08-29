import { describe, expect, it } from 'vitest';
import { readBlobText } from '../testing/readBlobText';
import { buildJsonRecordBlob } from './jsonRecordFile';

type SampleRecord = { id: number; text: string };

const HEADER = { schemaVersion: 1, exportedAt: '2026-08-29T09:00:00.000Z' };

function createRecords(count: number): SampleRecord[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: index + 1,
    text: `record ${String(index + 1)}`,
  }));
}

function pageFrom(records: readonly SampleRecord[]) {
  return (offset: number, limit: number) =>
    Promise.resolve(records.slice(offset, offset + limit));
}

async function readParsedBlob(blob: Blob): Promise<unknown> {
  return JSON.parse(await readBlobText(blob));
}

describe('buildJsonRecordBlob', () => {
  it('writes the header and every record in the order it was read', async () => {
    const records = createRecords(5);

    const blob = await buildJsonRecordBlob({
      header: HEADER,
      recordsKey: 'items',
      readPage: pageFrom(records),
      pageSize: 2,
    });

    expect(await readParsedBlob(blob)).toEqual({ ...HEADER, items: records });
  });

  // The reader is asked for one more page after a full one, because a file whose
  // record count is a multiple of the page size is otherwise cut short — or, read
  // the other way, never ends.
  it('ends on a page that is exactly full', async () => {
    const records = createRecords(4);
    const requestedOffsets: number[] = [];

    const blob = await buildJsonRecordBlob({
      header: HEADER,
      recordsKey: 'items',
      readPage: (offset, limit) => {
        requestedOffsets.push(offset);
        return pageFrom(records)(offset, limit);
      },
      pageSize: 2,
    });

    expect(requestedOffsets).toEqual([0, 2, 4]);
    expect(await readParsedBlob(blob)).toEqual({ ...HEADER, items: records });
  });

  it('writes an empty array when there is nothing stored', async () => {
    const blob = await buildJsonRecordBlob({
      header: HEADER,
      recordsKey: 'items',
      readPage: pageFrom([]),
      pageSize: 2,
    });

    expect(await readParsedBlob(blob)).toEqual({ ...HEADER, items: [] });
  });

  it('declares itself as JSON so a download is named and opened as one', async () => {
    const blob = await buildJsonRecordBlob({
      header: HEADER,
      recordsKey: 'items',
      readPage: pageFrom(createRecords(1)),
      pageSize: 2,
    });

    expect(blob.type).toBe('application/json');
  });
});
