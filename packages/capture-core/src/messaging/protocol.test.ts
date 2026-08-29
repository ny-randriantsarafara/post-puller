import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createCaptureProtocol } from './protocol';

// A six-field item with nothing Facebook or Messenger about it, so a passing
// test here means the protocol carries whatever a domain hands it.
const itemSchema = z.object({
  identityKey: z.string(),
  identitySource: z.enum(['externalId', 'externalUrl', 'contentHash']),
  fingerprint: z.string().nullable().default(null),
  externalId: z.string().nullable(),
  externalUrl: z.string().nullable(),
  collection: z.object({ name: z.string().nullable(), url: z.string() }),
  capturedAt: z.string(),
  updatedAt: z.string(),
});

const optionsSchema = z
  .object({ verbose: z.boolean().default(false) })
  .default({ verbose: false });

const protocol = createCaptureProtocol({ itemSchema, optionsSchema });

const item = {
  identityKey: 'externalId:1',
  identitySource: 'externalId' as const,
  fingerprint: null,
  externalId: '1',
  externalUrl: null,
  collection: { name: 'Sample', url: 'https://example.test/c/1' },
  capturedAt: '2026-08-29T10:00:00.000Z',
  updatedAt: '2026-08-29T10:00:00.000Z',
};

const session = {
  status: 'capturing' as const,
  mode: 'auto' as const,
  options: { verbose: true },
  autoScrollCompletedAt: null,
  tabId: 7,
  collectionUrl: 'https://example.test/c/1',
  collectionName: 'Sample',
  startedAt: '2026-08-29T10:00:00.000Z',
  stoppedAt: null,
  interruptedAt: null,
  collectionStats: [],
};

describe('createCaptureProtocol', () => {
  it('carries captured items of the domain type', () => {
    const request = protocol.parseBackgroundRequest({
      type: 'ITEMS_CAPTURED',
      tabId: 7,
      items: [item],
    });

    expect(request.type).toBe('ITEMS_CAPTURED');
    if (request.type !== 'ITEMS_CAPTURED') {
      throw new Error('expected an ITEMS_CAPTURED request');
    }

    expect(request.items).toHaveLength(1);
    expect(request.items[0]?.identityKey).toBe('externalId:1');
  });

  it('rejects a captured item that does not match the domain schema', () => {
    expect(() =>
      protocol.parseBackgroundRequest({
        type: 'ITEMS_CAPTURED',
        tabId: 7,
        items: [{ identityKey: 'externalId:1' }],
      }),
    ).toThrow();
  });

  it('rejects an unknown request type', () => {
    expect(() => protocol.parseBackgroundRequest({ type: 'NOT_A_REQUEST' })).toThrow();
  });

  it('carries the session with the domain options', () => {
    const response = protocol.parseBackgroundResponse({ type: 'SESSION', session });

    if (response.type !== 'SESSION') {
      throw new Error('expected a SESSION response');
    }

    expect(response.session.options.verbose).toBe(true);
    expect(response.session.mode).toBe('auto');
  });

  it('applies option defaults when a request omits them', () => {
    const request = protocol.parseBackgroundRequest({
      type: 'START_CAPTURE',
      tabId: 3,
      mode: 'manual',
    });

    if (request.type !== 'START_CAPTURE') {
      throw new Error('expected a START_CAPTURE request');
    }

    expect(request.options).toEqual({ verbose: false });
  });

  it('runs the session migration before validating', () => {
    const migratingProtocol = createCaptureProtocol({
      itemSchema,
      optionsSchema,
      migrateSession: (value) => {
        if (typeof value !== 'object' || value === null) {
          return value;
        }

        const { legacyTab, ...rest } = value as Record<string, unknown>;
        return { ...rest, tabId: legacyTab ?? null };
      },
    });

    const { tabId: _tabId, ...sessionWithoutTab } = session;
    const response = migratingProtocol.parseBackgroundResponse({
      type: 'SESSION',
      session: { ...sessionWithoutTab, legacyTab: 42 },
    });

    if (response.type !== 'SESSION') {
      throw new Error('expected a SESSION response');
    }

    expect(response.session.tabId).toBe(42);
  });

  it('parses the content script commands and replies', () => {
    expect(protocol.parseContentRequest({ type: 'END_CAPTURE' }).type).toBe(
      'END_CAPTURE',
    );
    expect(
      protocol.parseContentResponse({
        type: 'PAGE_INFO',
        isTargetPage: true,
        collectionName: 'Sample',
        collectionUrl: 'https://example.test/c/1',
      }).type,
    ).toBe('PAGE_INFO');
  });
});
