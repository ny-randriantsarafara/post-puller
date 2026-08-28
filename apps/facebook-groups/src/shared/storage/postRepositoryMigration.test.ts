import { describe, expect, it } from 'vitest';
import { listAllPosts } from './postRepository';
import type { CapturedPost } from '../types';

const DATABASE_NAME = 'facebookGroupCapture';
const LEGACY_DATABASE_VERSION = 1;
const STORE_NAME = 'capturedPosts';

// Exactly what the version before fingerprinting wrote: no fingerprint field.
const legacyPost: Omit<CapturedPost, 'fingerprint'> = {
  identityKey: 'postId:1',
  identitySource: 'postId',
  postId: '1',
  postUrl: 'https://www.facebook.com/groups/sample-group/posts/1/',
  group: {
    name: 'Sample Group',
    url: 'https://www.facebook.com/groups/sample-group',
  },
  author: { kind: 'named', name: 'Jane Doe', profileUrl: null },
  text: 'Captured before fingerprints existed',
  displayedDate: '1 hour ago',
  publishedAt: '2026-08-19T11:00:00.000Z',
  reactionCount: 2,
  comments: [],
  attachments: [{ kind: 'none' }],
  capturedAt: '2026-08-19T12:00:00.000Z',
  updatedAt: '2026-08-19T12:00:00.000Z',
  warnings: [],
};

function openLegacyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, LEGACY_DATABASE_VERSION);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'identityKey' });
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open the legacy database'));
    };
  });
}

function writeLegacyPost(database: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(legacyPost);

    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('Failed to write the legacy post'));
    };
  });
}

describe('postRepository schema upgrade', () => {
  it('keeps posts captured before fingerprints existed', async () => {
    const legacyDatabase = await openLegacyDatabase();
    await writeLegacyPost(legacyDatabase);
    legacyDatabase.close();

    const storedPosts = await listAllPosts();

    expect(storedPosts).toHaveLength(1);
    expect(storedPosts[0]?.postId).toBe('1');
    expect(storedPosts[0]?.fingerprint).toBeNull();
  });
});
