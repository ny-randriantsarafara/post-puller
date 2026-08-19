import type { CapturedPost, IdentitySource } from '../types';
import { capturedPostSchema } from '../messaging/protocol';
import { isBetterCapturedPost } from '../captureQuality';
import {
  contradictsStoredIdentity,
  isIdentifiableCapturedPost,
  isStrongerIdentity,
} from '../identity/postIdentity';
import { buildGroupStats, type GroupCaptureStats } from '../stats/groupStats';

const DATABASE_NAME = 'facebookGroupCapture';
const DATABASE_VERSION = 2;
const STORE_NAME = 'capturedPosts';
const FINGERPRINT_INDEX = 'by_fingerprint';

export type PostPage = {
  posts: CapturedPost[];
  total: number;
  offset: number;
  limit: number;
};

function parseStoredPost(value: unknown): CapturedPost | undefined {
  const parsed = capturedPostSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }

  return parsed.data;
}

function parseStoredPosts(values: unknown[]): CapturedPost[] {
  return values.flatMap((value) => {
    const post = parseStoredPost(value);
    if (post === undefined) {
      return [];
    }

    return [post];
  });
}

function resolveUpgradedStore(request: IDBOpenDBRequest): IDBObjectStore | null {
  const database = request.result;
  if (!database.objectStoreNames.contains(STORE_NAME)) {
    return database.createObjectStore(STORE_NAME, { keyPath: 'identityKey' });
  }

  return request.transaction?.objectStore(STORE_NAME) ?? null;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    // Records stored before fingerprinting have no fingerprint, and IndexedDB
    // leaves those out of the index instead of failing the upgrade.
    request.onupgradeneeded = () => {
      const store = resolveUpgradedStore(request);
      if (store === null || store.indexNames.contains(FINGERPRINT_INDEX)) {
        return;
      }

      store.createIndex(FINGERPRINT_INDEX, 'fingerprint', { unique: false });
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const result = operation(store);

        transaction.oncomplete = () => {
          if (result instanceof Promise) {
            result.then(resolve).catch(reject);
            return;
          }

          resolve(result.result);
        };

        transaction.onerror = () => {
          reject(transaction.error ?? new Error('IndexedDB transaction failed'));
        };
      }),
  );
}

export function isBetterParse(
  existingPost: CapturedPost,
  incomingPost: CapturedPost,
): boolean {
  return isBetterCapturedPost(existingPost, incomingPost);
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

// The identity key of a post without a Facebook id is a hash of content that
// Facebook changes between two sightings, so a re-sighting arrives under a new
// key. The fingerprint is what recognises it as an existing post.
async function findStoredPost(
  store: IDBObjectStore,
  incomingPost: CapturedPost,
): Promise<CapturedPost | null> {
  const postAtSameKey = parseStoredPost(
    await requestValue(store.get(incomingPost.identityKey)),
  );
  if (postAtSameKey !== undefined) {
    return postAtSameKey;
  }

  if (incomingPost.fingerprint === null) {
    return null;
  }

  const postWithSameFingerprint = parseStoredPost(
    await requestValue(store.index(FINGERPRINT_INDEX).get(incomingPost.fingerprint)),
  );
  if (postWithSameFingerprint === undefined) {
    return null;
  }

  if (contradictsStoredIdentity(postWithSameFingerprint, incomingPost)) {
    return null;
  }

  return postWithSameFingerprint;
}

function resolveMergedIdentity(
  existingPost: CapturedPost,
  incomingPost: CapturedPost,
): { identityKey: string; identitySource: IdentitySource } {
  if (isStrongerIdentity(existingPost, incomingPost)) {
    return {
      identityKey: incomingPost.identityKey,
      identitySource: incomingPost.identitySource,
    };
  }

  return {
    identityKey: existingPost.identityKey,
    identitySource: existingPost.identitySource,
  };
}

// A later sighting can finally expose the Facebook id of a post first stored
// under a content hash. The record then moves to the stronger key, so the export
// reports the identity the post actually has.
async function writeMergedPost(
  store: IDBObjectStore,
  existingPost: CapturedPost,
  incomingPost: CapturedPost,
): Promise<void> {
  const mergedPost: CapturedPost = {
    ...incomingPost,
    ...resolveMergedIdentity(existingPost, incomingPost),
    capturedAt: existingPost.capturedAt,
    updatedAt: incomingPost.updatedAt,
  };

  if (mergedPost.identityKey !== existingPost.identityKey) {
    await requestValue(store.delete(existingPost.identityKey));
  }

  await requestValue(store.put(mergedPost));
}

async function upsertPost(
  store: IDBObjectStore,
  incomingPost: CapturedPost,
): Promise<boolean> {
  const existingPost = await findStoredPost(store, incomingPost);

  if (existingPost === null) {
    await requestValue(store.put(incomingPost));
    return true;
  }

  if (!isBetterParse(existingPost, incomingPost)) {
    return false;
  }

  await writeMergedPost(store, existingPost, incomingPost);
  return false;
}

// Posts are written one after another because two sightings of the same post can
// land in the same batch, and concurrent lookups would both miss the fingerprint
// of a record the other one is about to insert.
async function upsertPostsInOrder(
  store: IDBObjectStore,
  posts: CapturedPost[],
): Promise<number> {
  let insertedCount = 0;

  for (const post of posts) {
    const wasInserted = await upsertPost(store, post);
    if (wasInserted) {
      insertedCount += 1;
    }
  }

  return insertedCount;
}

export async function upsertPosts(posts: CapturedPost[]): Promise<number> {
  // Records without identity material share one storage key, so they are refused
  // here rather than allowed to overwrite each other.
  const identifiablePosts = posts.filter(isIdentifiableCapturedPost);
  if (identifiablePosts.length === 0) {
    return 0;
  }

  return runTransaction('readwrite', (store) =>
    upsertPostsInOrder(store, identifiablePosts),
  );
}

export async function countPosts(): Promise<number> {
  return runTransaction('readonly', (store) => store.count());
}

export async function countIncompletePosts(): Promise<number> {
  const posts = await listAllPosts();
  return posts.filter((post) => post.warnings.length > 0).length;
}

export async function listAllPosts(): Promise<CapturedPost[]> {
  const values = await runTransaction('readonly', (store) => {
    const request = store.getAll();
    return request;
  });

  return parseStoredPosts(values);
}

export async function listGroupStats(): Promise<GroupCaptureStats[]> {
  const posts = await listAllPosts();
  return buildGroupStats(posts);
}

function filterPostsByGroup(
  posts: CapturedPost[],
  groupUrl: string | null,
): CapturedPost[] {
  if (groupUrl === null) {
    return posts;
  }

  return posts.filter((post) => post.group.url === groupUrl);
}

export async function listPostsPage(
  offset: number,
  limit: number,
  groupUrl: string | null = null,
): Promise<PostPage> {
  const allPosts = await listAllPosts();
  const filteredPosts = filterPostsByGroup(allPosts, groupUrl);
  const sortedPosts = [...filteredPosts].sort((left, right) =>
    right.capturedAt.localeCompare(left.capturedAt),
  );

  return {
    posts: sortedPosts.slice(offset, offset + limit),
    total: sortedPosts.length,
    offset,
    limit,
  };
}

export async function clearPosts(): Promise<void> {
  await runTransaction('readwrite', (store) => {
    const request = store.clear();
    return request;
  });
}

export async function clearGroupPosts(groupUrl: string): Promise<void> {
  const posts = await listAllPosts();
  const identityKeys = posts
    .filter((post) => post.group.url === groupUrl)
    .map((post) => post.identityKey);

  if (identityKeys.length === 0) {
    return;
  }

  await runTransaction('readwrite', (store) =>
    Promise.all(identityKeys.map((identityKey) => requestValue(store.delete(identityKey)))).then(
      () => undefined,
    ),
  );
}

export async function listIdentityKeys(): Promise<string[]> {
  const posts = await listAllPosts();
  return posts.map((post) => post.identityKey);
}
