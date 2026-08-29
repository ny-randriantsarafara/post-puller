import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CaptureDomain } from '../domain/captureDomain';
import { buildIdentityKey, type IdentityKeyPrefixes } from '../domain/identity';
import {
  applyCollectionStatsDeltas,
  type CollectionStatsDelta,
} from '../stats/collectionStats';
import { createItemRepository, type ItemPageOrder } from './itemRepository';

// A six-field item with no site knowledge in it, so what passes here is the
// generic dedup and key promotion rather than anything Facebook shaped.
type SampleItem = {
  identityKey: string;
  identitySource: 'externalId' | 'externalUrl' | 'contentHash';
  fingerprint: string | null;
  externalId: string | null;
  externalUrl: string | null;
  collection: { name: string | null; url: string };
  capturedAt: string;
  updatedAt: string;
  publishedAt: string | null;
  text: string;
  tags: string[];
};

const sampleItemSchema = z.object({
  identityKey: z.string(),
  identitySource: z.enum(['externalId', 'externalUrl', 'contentHash']),
  fingerprint: z.string().nullable().default(null),
  externalId: z.string().nullable(),
  externalUrl: z.string().nullable(),
  collection: z.object({ name: z.string().nullable(), url: z.string() }),
  capturedAt: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().nullable().default(null),
  text: z.string(),
  tags: z.array(z.string()).default([]),
});

// Deliberately unlike the field names, the way a real domain's persisted key
// prefixes outlive the rename of the field they were named after.
const SAMPLE_KEY_PREFIXES: IdentityKeyPrefixes = {
  externalId: 'sampleId',
  externalUrl: 'sampleUrl',
  contentHash: 'contentHash',
};

const sampleDomain: CaptureDomain<SampleItem, { verbose: boolean }> = {
  id: 'sample',
  itemSchema: sampleItemSchema,
  optionsSchema: z.object({ verbose: z.boolean().default(false) }),
  defaultOptions: { verbose: false },
  storage: {
    databaseName: 'sampleCapture',
    version: 1,
    itemStoreName: 'items',
    collectionIndexName: 'by_collection',
    stores: [
      {
        name: 'items',
        keyPath: 'identityKey',
        indexes: [
          { name: 'by_fingerprint', keyPath: 'fingerprint' },
          { name: 'by_collection', keyPath: 'collection.url' },
          { name: 'by_captured_at', keyPath: 'capturedAt' },
          {
            name: 'by_collection_captured_at',
            keyPath: ['collection.url', 'capturedAt'],
          },
        ],
      },
      { name: 'collections', keyPath: 'url', indexes: [] },
    ],
  },
  identityKeyPrefixes: SAMPLE_KEY_PREFIXES,
  stats: {
    countChildren: (item) => item.tags.length,
    readPublishedAt: (item) => item.publishedAt,
    // A stub for a site that truncates: a short record is one a later sighting
    // can still complete, which is what the counts have to follow.
    isIncomplete: (item) => item.text.length < 5,
  },
  isTargetUrl: (url) => url.startsWith('https://example.test/'),
  isBetterCapture: (existing, incoming) => incoming.text.length > existing.text.length,
  mergeCapture: (existing, incoming) => ({
    ...incoming,
    tags: [...new Set([...existing.tags, ...incoming.tags])],
  }),
  isIdentifiable: (item) => item.text.trim().length > 0,
};

const repository = createItemRepository(sampleDomain);

const COLLECTION = { name: 'Sample', url: 'https://example.test/c/1' };
const OTHER_COLLECTION = { name: 'Other', url: 'https://example.test/c/2' };

const NEWEST_FIRST: ItemPageOrder = {
  index: 'by_captured_at',
  collectionIndex: 'by_collection_captured_at',
  direction: 'prev',
};

function sumItemCount(deltas: CollectionStatsDelta[]): number {
  return deltas.reduce((total, delta) => total + delta.itemCount, 0);
}

function createItem(overrides: Partial<SampleItem> = {}): SampleItem {
  return {
    identityKey: buildIdentityKey(SAMPLE_KEY_PREFIXES, 'contentHash', 'hash-1'),
    identitySource: 'contentHash',
    fingerprint: 'fingerprint-1',
    externalId: null,
    externalUrl: null,
    collection: COLLECTION,
    capturedAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-08-29T10:00:00.000Z',
    publishedAt: null,
    text: 'a first sighting',
    tags: [],
    ...overrides,
  };
}

describe('createItemRepository', () => {
  beforeEach(async () => {
    await repository.clearItems();
  });

  it('inserts an item and reports it as one added to its collection', async () => {
    const deltas = await repository.upsertItems([createItem({ tags: ['a', 'b'] })]);

    expect(deltas).toEqual([
      {
        collection: COLLECTION,
        itemCount: 1,
        incompleteItemCount: 0,
        childCount: 2,
        publishedAt: null,
        capturedAt: '2026-08-29T10:00:00.000Z',
      },
    ]);
    expect(await repository.countItems()).toBe(1);
  });

  it('refuses an item the domain calls unidentifiable', async () => {
    const deltas = await repository.upsertItems([createItem({ text: '   ' })]);

    expect(deltas).toEqual([]);
    expect(await repository.countItems()).toBe(0);
  });

  it('recognises a re-sighting by fingerprint when the key changed', async () => {
    await repository.upsertItems([createItem()]);

    const deltas = await repository.upsertItems([
      createItem({
        identityKey: buildIdentityKey(SAMPLE_KEY_PREFIXES, 'contentHash', 'hash-2'),
        text: 'a first sighting, now with more text',
      }),
    ]);

    expect(sumItemCount(deltas)).toBe(0);
    expect(await repository.countItems()).toBe(1);
  });

  it('reports a truncated record as incomplete', async () => {
    const deltas = await repository.upsertItems([createItem({ text: 'cut' })]);

    expect(deltas[0]?.incompleteItemCount).toBe(1);
  });

  // The counts the popup shows are kept by adding these up, so a re-sighting
  // that completes a record has to report the completion and not a new item.
  it('reports a re-sighting that fills a record in as no longer incomplete', async () => {
    await repository.upsertItems([createItem({ text: 'cut', tags: ['a'] })]);

    const deltas = await repository.upsertItems([
      createItem({ text: 'the whole thing this time', tags: ['b', 'c'] }),
    ]);

    expect(deltas).toEqual([
      {
        collection: COLLECTION,
        itemCount: 0,
        incompleteItemCount: -1,
        childCount: 2,
        publishedAt: null,
        capturedAt: '2026-08-29T10:00:00.000Z',
      },
    ]);
  });

  it('promotes the record to the stronger key and drops the weaker one', async () => {
    await repository.upsertItems([createItem()]);

    await repository.upsertItems([
      createItem({
        identityKey: buildIdentityKey(SAMPLE_KEY_PREFIXES, 'externalId', '99'),
        identitySource: 'externalId',
        externalId: '99',
        text: 'a first sighting with the id finally exposed',
      }),
    ]);

    const items = await repository.listAllItems();

    expect(items).toHaveLength(1);
    expect(items[0]?.identityKey).toBe('sampleId:99');
    expect(items[0]?.identitySource).toBe('externalId');
  });

  it('keeps the first capturedAt and advances updatedAt on merge', async () => {
    await repository.upsertItems([createItem()]);

    await repository.upsertItems([
      createItem({
        text: 'a first sighting seen again later',
        capturedAt: '2026-08-30T10:00:00.000Z',
        updatedAt: '2026-08-30T10:00:00.000Z',
      }),
    ]);

    const items = await repository.listAllItems();

    expect(items[0]?.capturedAt).toBe('2026-08-29T10:00:00.000Z');
    expect(items[0]?.updatedAt).toBe('2026-08-30T10:00:00.000Z');
  });

  it('merges through the domain hook', async () => {
    await repository.upsertItems([createItem({ tags: ['one'] })]);

    await repository.upsertItems([
      createItem({ text: 'a first sighting, longer', tags: ['two'] }),
    ]);

    const items = await repository.listAllItems();

    expect(items[0]?.tags).toEqual(['one', 'two']);
  });

  it('leaves the stored record alone when the sighting is not better', async () => {
    await repository.upsertItems([createItem({ text: 'the longer first text' })]);

    await repository.upsertItems([createItem({ text: 'short' })]);

    const items = await repository.listAllItems();

    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe('the longer first text');
  });

  it('keeps two items apart when their ids disagree despite one fingerprint', async () => {
    await repository.upsertItems([
      createItem({
        identityKey: buildIdentityKey(SAMPLE_KEY_PREFIXES, 'externalId', '1'),
        identitySource: 'externalId',
        externalId: '1',
      }),
    ]);

    await repository.upsertItems([
      createItem({
        identityKey: buildIdentityKey(SAMPLE_KEY_PREFIXES, 'externalId', '2'),
        identitySource: 'externalId',
        externalId: '2',
      }),
    ]);

    expect(await repository.countItems()).toBe(2);
  });

  it('reinserting a batch inserts nothing', async () => {
    const batch = [
      createItem(),
      createItem({
        identityKey: buildIdentityKey(SAMPLE_KEY_PREFIXES, 'externalId', '7'),
        identitySource: 'externalId',
        externalId: '7',
        fingerprint: 'fingerprint-7',
        text: 'another item',
      }),
    ];

    expect(sumItemCount(await repository.upsertItems(batch))).toBe(2);
    expect(sumItemCount(await repository.upsertItems(batch))).toBe(0);
    expect(await repository.countItems()).toBe(2);
  });

  it('builds collection stats through the domain projection', async () => {
    await repository.upsertItems([
      createItem({ tags: ['a', 'b'] }),
      createItem({
        identityKey: buildIdentityKey(SAMPLE_KEY_PREFIXES, 'externalId', '8'),
        identitySource: 'externalId',
        externalId: '8',
        fingerprint: 'fingerprint-8',
        text: '',
      }),
    ]);

    const stats = await repository.listCollectionStats();

    expect(stats).toHaveLength(1);
    expect(stats[0]?.itemCount).toBe(1);
    expect(stats[0]?.childCount).toBe(2);
  });

  it('exposes a write hook that spans every declared store', async () => {
    await repository.upsertItems([createItem()]);

    const storedUrl = await repository.write(['items', 'collections'], async (stores) => {
      const collections = stores.get('collections');
      collections.put({ url: COLLECTION.url, itemCount: 1 });

      return new Promise<string>((resolve, reject) => {
        const request = stores.get('collections').get(COLLECTION.url);
        request.onsuccess = () => {
          resolve(COLLECTION.url);
        };
        request.onerror = () => {
          reject(request.error ?? new Error('read failed'));
        };
      });
    });

    expect(storedUrl).toBe(COLLECTION.url);
  });

  it('pages items and reports the unpaged total', async () => {
    await repository.upsertItems([
      createItem({ capturedAt: '2026-08-01T10:00:00.000Z' }),
      createItem({
        identityKey: buildIdentityKey(SAMPLE_KEY_PREFIXES, 'externalId', '10'),
        identitySource: 'externalId',
        externalId: '10',
        fingerprint: 'fingerprint-10',
        capturedAt: '2026-08-02T10:00:00.000Z',
        text: 'second',
      }),
      createItem({
        identityKey: buildIdentityKey(SAMPLE_KEY_PREFIXES, 'externalId', '11'),
        identitySource: 'externalId',
        externalId: '11',
        fingerprint: 'fingerprint-11',
        capturedAt: '2026-08-03T10:00:00.000Z',
        text: 'third',
      }),
    ]);

    const page = await repository.listItemsPage(NEWEST_FIRST, 1, 1);

    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.text).toBe('second');
  });

  it('pages one collection without the records of another', async () => {
    await repository.upsertItems([
      createItem({ capturedAt: '2026-08-01T10:00:00.000Z' }),
      createItem({
        identityKey: buildIdentityKey(SAMPLE_KEY_PREFIXES, 'externalId', '20'),
        identitySource: 'externalId',
        externalId: '20',
        fingerprint: 'fingerprint-20',
        collection: OTHER_COLLECTION,
        capturedAt: '2026-08-02T10:00:00.000Z',
        text: 'elsewhere',
      }),
      createItem({
        identityKey: buildIdentityKey(SAMPLE_KEY_PREFIXES, 'externalId', '21'),
        identitySource: 'externalId',
        externalId: '21',
        fingerprint: 'fingerprint-21',
        capturedAt: '2026-08-03T10:00:00.000Z',
        text: 'newest here',
      }),
    ]);

    const page = await repository.listItemsPage(NEWEST_FIRST, 0, 10, COLLECTION.url);

    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.text)).toEqual([
      'newest here',
      'a first sighting',
    ]);
  });

  // The popup's totals are kept by adding the deltas up, and only a scan that is
  // starting or data being cleared counts the store again. The two have to agree,
  // or a long scan reports something a reload silently corrects.
  it('totals kept from the deltas match a full count of the store', async () => {
    const batches: SampleItem[][] = [
      [createItem({ publishedAt: '2026-08-10T00:00:00.000Z', tags: ['a'] })],
      // A re-sighting under a new key that fills the first record in, so the
      // merge path and the incomplete count both move.
      [
        createItem({
          identityKey: buildIdentityKey(SAMPLE_KEY_PREFIXES, 'contentHash', 'hash-2'),
          text: 'a first sighting, filled in later',
          publishedAt: '2026-08-10T00:00:00.000Z',
          tags: ['b'],
        }),
        createItem({
          identityKey: buildIdentityKey(SAMPLE_KEY_PREFIXES, 'externalId', '40'),
          identitySource: 'externalId',
          externalId: '40',
          fingerprint: 'fingerprint-40',
          collection: OTHER_COLLECTION,
          capturedAt: '2026-08-31T10:00:00.000Z',
          publishedAt: '2026-08-05T00:00:00.000Z',
          text: 'cut',
        }),
      ],
      // Refused outright, and a sighting no better than what is stored: neither
      // may move a count.
      [
        createItem({ text: '  ' }),
        createItem({
          identityKey: buildIdentityKey(SAMPLE_KEY_PREFIXES, 'externalId', '40'),
          identitySource: 'externalId',
          externalId: '40',
          fingerprint: 'fingerprint-40',
          collection: OTHER_COLLECTION,
          text: 'cut',
        }),
      ],
      // The truncated record of the other collection, finally seen whole.
      [
        createItem({
          identityKey: buildIdentityKey(SAMPLE_KEY_PREFIXES, 'externalId', '40'),
          identitySource: 'externalId',
          externalId: '40',
          fingerprint: 'fingerprint-40',
          collection: OTHER_COLLECTION,
          capturedAt: '2026-09-01T10:00:00.000Z',
          publishedAt: '2026-08-05T00:00:00.000Z',
          text: 'cut no longer',
          tags: ['c'],
        }),
      ],
    ];

    const deltas: CollectionStatsDelta[] = [];
    for (const batch of batches) {
      deltas.push(...(await repository.upsertItems(batch)));
    }

    expect(applyCollectionStatsDeltas([], deltas)).toEqual(
      await repository.listCollectionStats(),
    );
  });

  it('clears one collection and leaves the other stored', async () => {
    await repository.upsertItems([
      createItem(),
      createItem({
        identityKey: buildIdentityKey(SAMPLE_KEY_PREFIXES, 'externalId', '30'),
        identitySource: 'externalId',
        externalId: '30',
        fingerprint: 'fingerprint-30',
        collection: OTHER_COLLECTION,
        text: 'elsewhere',
      }),
    ]);

    await repository.clearCollectionItems(COLLECTION.url);

    const items = await repository.listAllItems();

    expect(items).toHaveLength(1);
    expect(items[0]?.collection.url).toBe(OTHER_COLLECTION.url);
  });
});
