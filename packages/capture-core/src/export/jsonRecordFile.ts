// A page of records, read straight from storage. Returning fewer than asked for
// ends the file, the way a cursor that runs out does.
export type RecordPageReader = (
  offset: number,
  limit: number,
) => Promise<readonly unknown[]>;

export type JsonRecordFile = {
  readonly header: object;
  readonly recordsKey: string;
  readonly readPage: RecordPageReader;
  readonly pageSize: number;
};

// One record per line inside the array. The file stays greppable and diffable
// without the indentation, which on a conversation of 100 000 messages is a
// double-digit percentage of the bytes.
function serializeRecords(records: readonly unknown[], isFirstPage: boolean): string {
  const separator = isFirstPage ? '' : ',\n';

  return `${separator}${records.map((record) => JSON.stringify(record)).join(',\n')}`;
}

// The header is a bounded object, so it is serialised whole and then opened back
// up at its closing brace. slice(1, -1) of a stringified object is exactly its
// properties, which is what the records are then appended to.
function serializeHeader(header: object, recordsKey: string): string {
  const properties = JSON.stringify(header).slice(1, -1);

  return `{${properties},${JSON.stringify(recordsKey)}:[\n`;
}

// Each page becomes a blob of its own and leaves the JS heap immediately: a
// blob's bytes live in the browser's store, which can spill them to disk. Held
// as one string instead, an export is the whole conversation in memory twice —
// once as the string and once as the blob copied from it.
export async function buildJsonRecordBlob(file: JsonRecordFile): Promise<Blob> {
  const parts: BlobPart[] = [serializeHeader(file.header, file.recordsKey)];

  for (let offset = 0; ; offset += file.pageSize) {
    const records = await file.readPage(offset, file.pageSize);
    if (records.length > 0) {
      parts.push(new Blob([serializeRecords(records, offset === 0)]));
    }

    if (records.length < file.pageSize) {
      break;
    }
  }

  parts.push('\n]}\n');

  return new Blob(parts, { type: 'application/json' });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
