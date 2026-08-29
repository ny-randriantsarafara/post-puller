// jsdom's Blob has no text(), so a blob written by an export is read back the way
// a page would read one.
export function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('The blob did not read back as text'));
        return;
      }

      resolve(reader.result);
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read the blob'));
    };

    reader.readAsText(blob);
  });
}
