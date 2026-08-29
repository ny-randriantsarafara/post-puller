import { z } from 'zod';
import type { CollectionInfo } from '../domain/collection';
import type { Schema } from '../domain/schema';

export type CaptureStatus = 'idle' | 'capturing' | 'interrupted';

export type CaptureMode = 'manual' | 'auto';

export type PublicationWindow = {
  earliest: string | null;
  latest: string | null;
};

// One row of the "what is already stored" breakdown. Counts are named for items
// and their children rather than posts and comments, because a group counts
// posts with comments and a thread counts messages with reactions through the
// same shape.
export type CollectionCaptureStats = {
  collection: CollectionInfo;
  itemCount: number;
  incompleteItemCount: number;
  childCount: number;
  publicationWindow: PublicationWindow;
  lastCapturedAt: string;
};

export type CaptureSession<TOptions extends object> = {
  status: CaptureStatus;
  mode: CaptureMode;
  options: TOptions;
  // Set when auto-scroll gave up because the page stopped yielding new content.
  // Capture keeps running, so anything loaded afterwards is still stored.
  autoScrollCompletedAt: string | null;
  tabId: number | null;
  collectionUrl: string | null;
  collectionName: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  interruptedAt: string | null;
  collectionStats: CollectionCaptureStats[];
};

export const captureModeSchema = z.enum(['manual', 'auto']);

export const collectionInfoSchema = z.object({
  name: z.string().nullable(),
  url: z.string(),
});

export const publicationWindowSchema = z.object({
  earliest: z.string().nullable(),
  latest: z.string().nullable(),
});

export const collectionCaptureStatsSchema = z.object({
  collection: collectionInfoSchema,
  itemCount: z.number(),
  incompleteItemCount: z.number(),
  childCount: z.number(),
  publicationWindow: publicationWindowSchema,
  lastCapturedAt: z.string(),
});

// The domain's own options schema is applied in a second pass rather than
// embedded here. Embedded, its output type is an unresolved type parameter, and
// zod then has to treat the field as optional because it cannot prove that
// undefined is not a member of it.
const sessionFieldsSchema = z.object({
  status: z.enum(['idle', 'capturing', 'interrupted']),
  mode: captureModeSchema.default('manual'),
  options: z.unknown(),
  autoScrollCompletedAt: z.string().nullable().default(null),
  tabId: z.number().nullable(),
  collectionUrl: z.string().nullable(),
  collectionName: z.string().nullable(),
  startedAt: z.string().nullable(),
  stoppedAt: z.string().nullable(),
  interruptedAt: z.string().nullable(),
  collectionStats: z.array(collectionCaptureStatsSchema).default([]),
});

export function buildEmptyCaptureSession<TOptions extends object>(
  defaultOptions: TOptions,
): CaptureSession<TOptions> {
  return {
    status: 'idle',
    mode: 'manual',
    options: defaultOptions,
    autoScrollCompletedAt: null,
    tabId: null,
    collectionUrl: null,
    collectionName: null,
    startedAt: null,
    stoppedAt: null,
    interruptedAt: null,
    collectionStats: [],
  };
}

function keepAsIs(value: unknown): unknown {
  return value;
}

// Always wrapped in a preprocess step, even without a migration to run, so the
// returned schema has one shape regardless of what the caller passed.
export function createCaptureSessionSchema<TOptions extends object>(
  optionsSchema: Schema<TOptions>,
  migrateSession?: (value: unknown) => unknown,
): Schema<CaptureSession<TOptions>> {
  return z.preprocess(
    migrateSession ?? keepAsIs,
    sessionFieldsSchema.transform(
      (fields): CaptureSession<TOptions> => ({
        ...fields,
        options: optionsSchema.parse(fields.options),
      }),
    ),
  );
}
