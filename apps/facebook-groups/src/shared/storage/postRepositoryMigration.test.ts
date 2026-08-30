import { describe, expect, it } from 'vitest';
import { listAllPosts, listPostsPage, upsertPosts } from './postRepository';
import { finalizeCapturedPost } from '../identity/postIdentity';
import type { Attachment, CapturedComment, PostAuthor, PostWarning } from '../types';

const DATABASE_NAME = 'facebookGroupCapture';
const LEGACY_DATABASE_VERSION = 1;
const STORE_NAME = 'capturedPosts';

// The record the extension used to write: Facebook field names, no fingerprint,
// and none of the engagement fields that arrived with it. Spelled out rather
// than derived from CapturedPost, because the point is that it differs.
type LegacyStoredPost = {
  identityKey: string;
  identitySource: 'postId' | 'postUrl' | 'contentHash';
  postId: string | null;
  postUrl: string | null;
  group: { name: string | null; url: string };
  author: PostAuthor;
  text: string | null;
  displayedDate: string | null;
  publishedAt: string | null;
  reactionCount: number | null;
  comments: CapturedComment[];
  attachments: Attachment[];
  capturedAt: string;
  updatedAt: string;
  warnings: PostWarning[];
};

const COLLECTION_URL = 'https://www.facebook.com/groups/sample-group';

const legacyPost: LegacyStoredPost = {
  identityKey: 'postId:1',
  identitySource: 'postId',
  postId: '1',
  postUrl: `${COLLECTION_URL}/posts/1/`,
  group: {
    name: 'Sample Group',
    url: COLLECTION_URL,
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

// Whatever version the database is already at, which is how a real upgrade
// looks: the version moves forward while the records keep the shape they were
// written with.
function openDatabaseAtCurrentVersion(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'identityKey' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open the database'));
    };
  });
}

function writeLegacyPost(
  database: IDBDatabase,
  post: LegacyStoredPost = legacyPost,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(post);

    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('Failed to write the legacy post'));
    };
  });
}

async function seedLegacyPost(post: LegacyStoredPost = legacyPost): Promise<void> {
  const database = await openDatabaseAtCurrentVersion();
  await writeLegacyPost(database, post);
  database.close();
}

describe('postRepository schema upgrade', () => {
  // Runs first on purpose: it is the only test that opens the database at
  // version 1, which requires that nothing has upgraded it yet. It is therefore
  // also the only test that sees the upgrade to the current version happen, and
  // so the only place the backfill below can be observed.
  it('keeps posts captured before fingerprints existed', async () => {
    const legacyDatabase = await openLegacyDatabase();
    await writeLegacyPost(legacyDatabase);
    legacyDatabase.close();

    const storedPosts = await listAllPosts();

    expect(storedPosts).toHaveLength(1);
    expect(storedPosts[0]?.externalId).toBe('1');
    expect(storedPosts[0]?.fingerprint).toBeNull();
  });

  // The failure this guards against is silent in a different way: a record with
  // no sortKey is not in the index publication order reads, so it would be
  // stored, exported, counted, and missing from every page of the preview.
  it('gives a post written before publication order a place in it', async () => {
    const page = await listPostsPage('newestPublication', 0, 20);

    expect(page.total).toBe(1);
    expect(page.posts[0]?.identityKey).toBe('postId:1');
    expect(page.posts[0]?.sortKey).toBe('2026-08-19T11:00:00.000Z');
  });

  it('reads records written under the Facebook field names', async () => {
    await seedLegacyPost();

    const storedPosts = await listAllPosts();

    expect(storedPosts[0]?.identitySource).toBe('externalId');
    expect(storedPosts[0]?.externalUrl).toBe(`${COLLECTION_URL}/posts/1/`);
    expect(storedPosts[0]?.collection).toEqual({
      name: 'Sample Group',
      url: COLLECTION_URL,
    });
  });

  // The failure this guards against is silent: were the identity key prefix to
  // follow the field rename, this post would be looked up under externalId:1,
  // miss the stored record, and be inserted a second time.
  it('recaptures a renamed record in place instead of duplicating it', async () => {
    await seedLegacyPost();

    const recapturedPost = await finalizeCapturedPost(
      {
        externalId: '1',
        externalUrl: `${COLLECTION_URL}/posts/1/`,
        collection: { name: 'Sample Group', url: COLLECTION_URL },
        author: { kind: 'named', name: 'Jane Doe', profileUrl: null },
        text: 'Captured before fingerprints existed, and seen again since',
        displayedDate: '2 hours ago',
        publishedAt: '2026-08-19T11:00:00.000Z',
        reactionCount: 3,
        reactionBreakdown: {},
        commentCount: null,
        shareCount: null,
        comments: [],
        attachments: [{ kind: 'none' }],
        warnings: [],
      },
      null,
      '2026-08-19T13:00:00.000Z',
    );

    expect(recapturedPost.identityKey).toBe('postId:1');

    await upsertPosts([recapturedPost]);

    const storedPosts = await listAllPosts();

    expect(storedPosts).toHaveLength(1);
    expect(storedPosts[0]?.identityKey).toBe('postId:1');
    expect(storedPosts[0]?.capturedAt).toBe('2026-08-19T12:00:00.000Z');
  });
});
