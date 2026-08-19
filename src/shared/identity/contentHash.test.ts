import { describe, expect, it } from 'vitest';
import { createContentHash } from './contentHash';

describe('createContentHash', () => {
  it('creates a stable hash for normalized content', async () => {
    const firstHash = await createContentHash({
      authorLabel: 'Jane Doe',
      text: 'Hello   world',
      displayedDate: '2 hours ago',
    });
    const secondHash = await createContentHash({
      authorLabel: 'Jane Doe',
      text: 'Hello world',
      displayedDate: '2 hours ago',
    });

    expect(firstHash).toBe(secondHash);
    expect(firstHash).toHaveLength(64);
  });
});
