import { z } from 'zod';

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
  author: postAuthorSchema,
  text: z.string().nullable(),
  displayedDate: z.string().nullable(),
  publishedAt: z.string().nullable(),
  reactionCount: z.number().nullable(),
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
      'COLLAPSED_COMMENTS',
      'HIDDEN_COMMENTS',
      'UNKNOWN_ATTACHMENT',
    ]),
  ),
});

export const captureModeSchema = z.enum(['manual', 'auto']);

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

export const captureSessionSchema = z.object({
  status: z.enum(['idle', 'capturing', 'interrupted']),
  // Defaulted so a session stored before the scan modes existed still reads back.
  mode: captureModeSchema.default('manual'),
  autoScrollCompletedAt: z.string().nullable().default(null),
  tabId: z.number().nullable(),
  groupUrl: z.string().nullable(),
  groupName: z.string().nullable(),
  startedAt: z.string().nullable(),
  stoppedAt: z.string().nullable(),
  interruptedAt: z.string().nullable(),
  // Defaulted so sessions stored before per-group stats existed still read back.
  groupStats: z.array(groupCaptureStatsSchema).default([]),
});

export const backgroundRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('GET_SESSION') }),
  z.object({
    type: z.literal('START_CAPTURE'),
    tabId: z.number(),
    mode: captureModeSchema,
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
  z.object({ type: z.literal('BEGIN_CAPTURE'), mode: captureModeSchema }),
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
