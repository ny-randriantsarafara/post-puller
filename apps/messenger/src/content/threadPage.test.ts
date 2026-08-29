import { beforeEach, describe, expect, it } from 'vitest';
import {
  isThreadPage,
  resolveThreadIdSource,
  resolveThreadPageTarget,
  resolveThreadTarget,
} from './threadPage';

function locationOf(url: string): Location {
  return new URL(url) as unknown as Location;
}

const NUMERIC_ID = '61550123456789';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('resolveThreadTarget', () => {
  // The reason thread identity is taken from the path at all: one conversation
  // has to group under one key no matter which surface it was captured from.
  it('reads the same threadId from both surfaces', () => {
    const surfaces = [
      `https://www.messenger.com/t/${NUMERIC_ID}`,
      `https://www.facebook.com/messages/t/${NUMERIC_ID}`,
      `https://www.messenger.com/t/${NUMERIC_ID}/`,
      `https://www.facebook.com/messages/t/${NUMERIC_ID}?source=notification`,
    ];

    const threadIds = surfaces.map(
      (url) => resolveThreadTarget(locationOf(url)).threadId,
    );

    expect(new Set(threadIds)).toEqual(new Set([NUMERIC_ID]));
  });

  it('reads the same threadId from both encrypted surfaces', () => {
    const messenger = resolveThreadTarget(
      locationOf(`https://www.messenger.com/e2ee/t/${NUMERIC_ID}`),
    );
    const facebook = resolveThreadTarget(
      locationOf(`https://www.facebook.com/messages/e2ee/t/${NUMERIC_ID}`),
    );

    expect(messenger.threadId).toBe(NUMERIC_ID);
    expect(facebook.threadId).toBe(NUMERIC_ID);
  });

  // Nobody should be able to export an end-to-end encrypted conversation
  // without the export saying so.
  it('marks an encrypted thread and leaves an ordinary one unmarked', () => {
    expect(
      resolveThreadTarget(locationOf(`https://www.messenger.com/e2ee/t/${NUMERIC_ID}`))
        .isEncryptedThread,
    ).toBe(true);
    expect(
      resolveThreadTarget(locationOf(`https://www.messenger.com/t/${NUMERIC_ID}`))
        .isEncryptedThread,
    ).toBe(false);
  });

  it('refuses a page that is not a thread', () => {
    const nonThreads = [
      'https://www.messenger.com/',
      'https://www.messenger.com/marketplace',
      'https://www.facebook.com/messages',
      'https://www.facebook.com/groups/123',
    ];

    for (const url of nonThreads) {
      expect(resolveThreadTarget(locationOf(url)).isThreadPage).toBe(false);
      expect(isThreadPage(locationOf(url))).toBe(false);
    }
  });

  it('ranks a numeric id above a vanity handle', () => {
    expect(resolveThreadIdSource(NUMERIC_ID)).toBe('numeric');
    expect(resolveThreadIdSource('alice.dupont')).toBe('vanity');
  });

  it('decodes a percent-encoded handle', () => {
    expect(
      resolveThreadTarget(locationOf('https://www.messenger.com/t/alice%2Edupont'))
        .threadId,
    ).toBe('alice.dupont');
  });

  it('reads the thread title from the accessible name of the log', () => {
    document.body.innerHTML = '<div role="log" aria-label="Alex Moreau"></div>';

    expect(
      resolveThreadTarget(locationOf(`https://www.messenger.com/t/${NUMERIC_ID}`))
        .threadTitle,
    ).toBe('Alex Moreau');
  });
});

describe('resolveThreadPageTarget', () => {
  // Two captures of one conversation must not become two collections just
  // because they were taken from different surfaces.
  it('normalises the collection url to one surface', () => {
    const messenger = resolveThreadPageTarget(
      locationOf(`https://www.messenger.com/t/${NUMERIC_ID}`),
    );
    const facebook = resolveThreadPageTarget(
      locationOf(`https://www.facebook.com/messages/t/${NUMERIC_ID}`),
    );

    expect(facebook.collectionUrl).toBe(messenger.collectionUrl);
    expect(messenger.collectionUrl).toBe(
      `https://www.messenger.com/t/${NUMERIC_ID}`,
    );
  });

  it('reports a non-thread page as untargetable', () => {
    const target = resolveThreadPageTarget(locationOf('https://www.messenger.com/'));

    expect(target).toEqual({
      isTargetPage: false,
      collectionName: null,
      collectionUrl: null,
    });
  });
});
