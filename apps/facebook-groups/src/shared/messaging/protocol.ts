import {
  createCaptureProtocol,
  type BackgroundRequest as CoreBackgroundRequest,
  type BackgroundResponse as CoreBackgroundResponse,
  type ContentRequest as CoreContentRequest,
  type ContentResponse as CoreContentResponse,
} from '@extractor/capture-core/messaging';
import { z } from 'zod';
import type { CaptureOptions } from '../types/captureOptions';
import type { CapturedPost } from '../types/post';
import { REACTION_TYPES } from '../types/reactions';
import { COMMENT_WARNINGS, POST_WARNINGS } from '../types/warnings';

const reactionBreakdownSchema = z
  .record(z.enum(REACTION_TYPES), z.number())
  .default({});

const postAuthorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('named'),
    name: z.string(),
    profileUrl: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('anonymous'),
    label: z.string(),
  }),
  z.object({
    kind: z.literal('unknown'),
  }),
]);

const attachmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['image', 'video', 'link', 'sharedPost']),
    url: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('none'),
  }),
  z.object({
    kind: z.literal('unknown'),
  }),
]);

const commentSchema = z.object({
  commentId: z.string().nullable().default(null),
  parentCommentId: z.string().nullable().default(null),
  depth: z.number().default(0),
  author: postAuthorSchema,
  text: z.string().nullable(),
  displayedDate: z.string().nullable(),
  publishedAt: z.string().nullable(),
  reactionCount: z.number().nullable(),
  reactionBreakdown: reactionBreakdownSchema,
  warnings: z.array(z.enum(COMMENT_WARNINGS)),
});

const collectionInfoSchema = z.object({
  name: z.string().nullable(),
  url: z.string(),
});

// Records written before posts became generic captured items used the field
// names of a Facebook post. identityKey is deliberately left alone: it is the
// primary key these records are stored under.
function migrateLegacyPost(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const record = value as Record<string, unknown>;
  if (record['collection'] !== undefined) {
    return value;
  }

  const { postId, postUrl, group, identitySource, ...rest } = record;

  return {
    ...rest,
    identitySource: migrateLegacyIdentitySource(identitySource),
    externalId: postId ?? null,
    externalUrl: postUrl ?? null,
    collection: group,
  };
}

function migrateLegacyIdentitySource(value: unknown): unknown {
  if (value === 'postId') {
    return 'externalId';
  }

  if (value === 'postUrl') {
    return 'externalUrl';
  }

  return value;
}

const capturedPostFieldsSchema = z.object({
  identityKey: z.string(),
  identitySource: z.enum(['externalId', 'externalUrl', 'contentHash']),
  // Defaulted so records written before fingerprinting existed still read back.
  fingerprint: z.string().nullable().default(null),
  externalId: z.string().nullable(),
  externalUrl: z.string().nullable(),
  collection: collectionInfoSchema,
  author: postAuthorSchema,
  text: z.string().nullable(),
  displayedDate: z.string().nullable(),
  publishedAt: z.string().nullable(),
  reactionCount: z.number().nullable(),
  reactionBreakdown: reactionBreakdownSchema,
  commentCount: z.number().nullable().default(null),
  shareCount: z.number().nullable().default(null),
  comments: z.array(commentSchema),
  attachments: z.array(attachmentSchema),
  capturedAt: z.string(),
  updatedAt: z.string(),
  warnings: z.array(z.enum(POST_WARNINGS)),
});

export const capturedPostSchema = z.preprocess(
  migrateLegacyPost,
  capturedPostFieldsSchema,
);

export const captureOptionsSchema = z
  .object({
    expandPostText: z.boolean().default(true),
    expandComments: z.boolean().default(false),
    captureReactions: z.boolean().default(true),
  })
  .default({
    expandPostText: true,
    expandComments: false,
    captureReactions: true,
  });

// Sessions stored before capture options existed only had expandComments.
function migrateLegacyOptions(record: Record<string, unknown>): Record<string, unknown> {
  if (record['options'] !== undefined) {
    return record;
  }

  return {
    ...record,
    options: {
      expandPostText: true,
      expandComments: record['expandComments'] === true,
      captureReactions: true,
    },
  };
}

// Sessions stored while a captured collection was still called a group.
function migrateLegacyCollection(record: Record<string, unknown>): Record<string, unknown> {
  if (record['collectionUrl'] !== undefined) {
    return record;
  }

  const { groupUrl, groupName, groupStats, ...rest } = record;

  return {
    ...rest,
    collectionUrl: groupUrl ?? null,
    collectionName: groupName ?? null,
    collectionStats: Array.isArray(groupStats)
      ? groupStats.map(migrateLegacyCollectionStats)
      : [],
  };
}

// Stats rows counted posts and comments by name before the session shape became
// generic over captured items.
function migrateLegacyCollectionStats(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const record = value as Record<string, unknown>;
  if (record['itemCount'] !== undefined) {
    return value;
  }

  const { group, postCount, incompletePostCount, commentCount, ...rest } = record;

  return {
    ...rest,
    collection: record['collection'] ?? group,
    itemCount: postCount ?? 0,
    incompleteItemCount: incompletePostCount ?? 0,
    childCount: commentCount ?? 0,
  };
}

function migrateLegacySession(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const migrated = migrateLegacyCollection(
    migrateLegacyOptions(value as Record<string, unknown>),
  );
  const collectionStats = migrated['collectionStats'];

  return {
    ...migrated,
    collectionStats: Array.isArray(collectionStats)
      ? collectionStats.map(migrateLegacyCollectionStats)
      : collectionStats,
  };
}

export const captureProtocol = createCaptureProtocol<CapturedPost, CaptureOptions>({
  itemSchema: capturedPostSchema,
  optionsSchema: captureOptionsSchema,
  migrateSession: migrateLegacySession,
});

export const captureSessionSchema = captureProtocol.sessionSchema;

export type BackgroundRequest = CoreBackgroundRequest<CapturedPost, CaptureOptions>;
export type BackgroundResponse = CoreBackgroundResponse<CaptureOptions>;
export type ContentRequest = CoreContentRequest<CaptureOptions>;
export type ContentResponse = CoreContentResponse;

export const parseBackgroundRequest = captureProtocol.parseBackgroundRequest;
export const parseBackgroundResponse = captureProtocol.parseBackgroundResponse;
export const parseContentRequest = captureProtocol.parseContentRequest;
export const parseContentResponse = captureProtocol.parseContentResponse;
