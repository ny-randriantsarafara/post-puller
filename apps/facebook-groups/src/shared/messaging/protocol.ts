import { z } from 'zod';
import { REACTION_TYPES } from '../types/reactions';

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
  warnings: z.array(
    z.enum([
      'MISSING_AUTHOR',
      'MISSING_TEXT',
      'MISSING_DATE',
      'UNPARSED_DATE',
      'MISSING_REACTION_COUNT',
    ]),
  ),
});

export const capturedPostSchema = z.object({
  identityKey: z.string(),
  identitySource: z.enum(['postId', 'postUrl', 'contentHash']),
  // Defaulted so records written before fingerprinting existed still read back.
  fingerprint: z.string().nullable().default(null),
  postId: z.string().nullable(),
  postUrl: z.string().nullable(),
  group: z.object({
    name: z.string().nullable(),
    url: z.string(),
  }),
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
  warnings: z.array(
    z.enum([
      'MISSING_POST_ID',
      'MISSING_POST_URL',
      'MISSING_AUTHOR',
      'MISSING_TEXT',
      'TRUNCATED_TEXT',
      'MISSING_DATE',
      'UNPARSED_DATE',
      'MISSING_REACTION_COUNT',
      'PARTIAL_REACTION_BREAKDOWN',
      'COLLAPSED_COMMENTS',
      'HIDDEN_COMMENTS',
      'MISSING_COMMENTS',
      'UNKNOWN_ATTACHMENT',
    ]),
  ),
});

export const captureModeSchema = z.enum(['manual', 'auto']);

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
function migrateLegacySession(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const record = value as Record<string, unknown>;
  if (record['options'] !== undefined) {
    return value;
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

const publicationWindowSchema = z.object({
  earliest: z.string().nullable(),
  latest: z.string().nullable(),
});

export const groupCaptureStatsSchema = z.object({
  group: z.object({
    name: z.string().nullable(),
    url: z.string(),
  }),
  postCount: z.number(),
  incompletePostCount: z.number(),
  commentCount: z.number(),
  publicationWindow: publicationWindowSchema,
  lastCapturedAt: z.string(),
});

const captureSessionFieldsSchema = z.object({
  status: z.enum(['idle', 'capturing', 'interrupted']),
  mode: captureModeSchema.default('manual'),
  options: captureOptionsSchema,
  autoScrollCompletedAt: z.string().nullable().default(null),
  tabId: z.number().nullable(),
  groupUrl: z.string().nullable(),
  groupName: z.string().nullable(),
  startedAt: z.string().nullable(),
  stoppedAt: z.string().nullable(),
  interruptedAt: z.string().nullable(),
  groupStats: z.array(groupCaptureStatsSchema).default([]),
});

export const captureSessionSchema = z.preprocess(
  migrateLegacySession,
  captureSessionFieldsSchema,
);

export const backgroundRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('GET_SESSION') }),
  z.object({
    type: z.literal('START_CAPTURE'),
    tabId: z.number(),
    mode: captureModeSchema,
    options: captureOptionsSchema,
  }),
  z.object({ type: z.literal('STOP_CAPTURE') }),
  z.object({ type: z.literal('CLEAR_DATA') }),
  z.object({ type: z.literal('CLEAR_GROUP_DATA'), groupUrl: z.string() }),
  z.object({
    type: z.literal('POSTS_CAPTURED'),
    tabId: z.number(),
    posts: z.array(capturedPostSchema),
  }),
  z.object({ type: z.literal('CAPTURE_INTERRUPTED'), tabId: z.number() }),
  z.object({ type: z.literal('AUTO_SCROLL_COMPLETED'), tabId: z.number() }),
]);

export const backgroundResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('SESSION'),
    session: captureSessionSchema,
  }),
  z.object({
    type: z.literal('ERROR'),
    message: z.string(),
  }),
  z.object({
    type: z.literal('SUCCESS'),
    session: captureSessionSchema,
  }),
]);

export const contentRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('BEGIN_CAPTURE'),
    mode: captureModeSchema,
    options: captureOptionsSchema,
  }),
  z.object({ type: z.literal('END_CAPTURE') }),
  z.object({ type: z.literal('GET_PAGE_INFO') }),
]);

export const contentResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('PAGE_INFO'),
    isGroupPage: z.boolean(),
    groupName: z.string().nullable(),
    groupUrl: z.string().nullable(),
  }),
  z.object({
    type: z.literal('CAPTURE_STATE'),
    isCapturing: z.boolean(),
  }),
  z.object({
    type: z.literal('ERROR'),
    message: z.string(),
  }),
]);

export type BackgroundRequest = z.infer<typeof backgroundRequestSchema>;
export type BackgroundResponse = z.infer<typeof backgroundResponseSchema>;
export type ContentRequest = z.infer<typeof contentRequestSchema>;
export type ContentResponse = z.infer<typeof contentResponseSchema>;

export function parseBackgroundRequest(value: unknown): BackgroundRequest {
  return backgroundRequestSchema.parse(value);
}

export function parseBackgroundResponse(value: unknown): BackgroundResponse {
  return backgroundResponseSchema.parse(value);
}

export function parseContentRequest(value: unknown): ContentRequest {
  return contentRequestSchema.parse(value);
}

export function parseContentResponse(value: unknown): ContentResponse {
  return contentResponseSchema.parse(value);
}
