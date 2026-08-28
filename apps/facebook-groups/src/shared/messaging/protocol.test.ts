import { describe, expect, it } from 'vitest';
import { captureSessionSchema } from './protocol';

const COLLECTION_URL = 'https://www.facebook.com/groups/sample-group';

// The session shape persisted in chrome.storage before a captured collection
// stopped being called a group.
const legacySession = {
  status: 'idle',
  mode: 'auto',
  expandComments: true,
  autoScrollCompletedAt: null,
  tabId: null,
  groupUrl: COLLECTION_URL,
  groupName: 'Sample Group',
  startedAt: null,
  stoppedAt: null,
  interruptedAt: null,
  groupStats: [
    {
      group: { name: 'Sample Group', url: COLLECTION_URL },
      postCount: 3,
      incompletePostCount: 1,
      commentCount: 7,
      publicationWindow: { earliest: null, latest: null },
      lastCapturedAt: '2026-08-19T12:00:00.000Z',
    },
  ],
};

describe('captureSessionSchema', () => {
  it('reads a session stored under the group field names', () => {
    const session = captureSessionSchema.parse(legacySession);

    expect(session.collectionUrl).toBe(COLLECTION_URL);
    expect(session.collectionName).toBe('Sample Group');
    expect(session.collectionStats[0]?.collection).toEqual({
      name: 'Sample Group',
      url: COLLECTION_URL,
    });
    expect(session.collectionStats[0]?.postCount).toBe(3);
  });

  it('keeps the capture options a legacy session had chosen', () => {
    const session = captureSessionSchema.parse(legacySession);

    expect(session.options).toEqual({
      expandPostText: true,
      expandComments: true,
      captureReactions: true,
    });
  });

  it('leaves a current session untouched', () => {
    const current = {
      ...legacySession,
      expandComments: undefined,
      groupUrl: undefined,
      groupName: undefined,
      groupStats: undefined,
      options: {
        expandPostText: false,
        expandComments: false,
        captureReactions: false,
      },
      collectionUrl: COLLECTION_URL,
      collectionName: 'Sample Group',
      collectionStats: [],
    };

    const session = captureSessionSchema.parse(current);

    expect(session.options.expandPostText).toBe(false);
    expect(session.collectionUrl).toBe(COLLECTION_URL);
    expect(session.collectionStats).toEqual([]);
  });
});
