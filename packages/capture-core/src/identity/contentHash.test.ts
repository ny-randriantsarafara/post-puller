import { describe, expect, it } from 'vitest';
import { buildHashInput, createContentHash } from './contentHash';

describe('createContentHash', () => {
  it('creates a stable hash for normalized content', async () => {
    const firstHash = await createContentHash(['Jane Doe', 'Hello   world', '2 hours ago']);
    const secondHash = await createContentHash(['Jane Doe', 'Hello world', '2 hours ago']);

    expect(firstHash).toBe(secondHash);
    expect(firstHash).toHaveLength(64);
  });

  // identityKey is an IndexedDB primary key, so changing how a hash is built
  // makes every stored record unreachable and re-inserts it as a duplicate.
  // This pins the digest that records in the wild were written under.
  it('still produces the digest that stored records were keyed by', async () => {
    const hash = await createContentHash(['Jane Doe', 'Hello world', '2 hours ago']);

    expect(hash).toBe(
      'be4af7e660c8fcb36c94805c623d8d7aa00950ceccd9a691a7123f4ce0fd6c91',
    );
  });

  it('separates parts so that moving text between them changes the hash', async () => {
    const firstHash = await createContentHash(['Jane', 'Doe']);
    const secondHash = await createContentHash(['Jane Doe', '']);

    expect(firstHash).not.toBe(secondHash);
  });

  it('keeps the slot of a missing part so it cannot collide with a shorter item', () => {
    expect(buildHashInput(['Jane', null, 'today'])).toBe('Jane\n\ntoday');
    expect(buildHashInput(['Jane', 'today'])).toBe('Jane\ntoday');
  });
});
