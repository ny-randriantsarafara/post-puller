import {
  createCaptureProtocol,
  type BackgroundRequest as CoreBackgroundRequest,
  type BackgroundResponse as CoreBackgroundResponse,
  type ContentRequest as CoreContentRequest,
  type ContentResponse as CoreContentResponse,
} from '@extractor/capture-core/messaging';
import { z } from 'zod';
import type { CapturedMessage } from '../types/capturedMessage';
import type { ScanOptions } from '../types/scanOptions';
import { SCAN_STOP_REASONS } from '../types/thread';
import { MESSAGE_WARNINGS } from '../types/warnings';

const collectionInfoSchema = z.object({
  name: z.string().nullable(),
  url: z.string(),
});

const messageSenderSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('self') }),
  z.object({ kind: z.literal('other'), name: z.string() }),
]);

const messageReactionSchema = z.object({
  count: z.number(),
  emoji: z.string(),
});

const messageAttachmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('file'), caption: z.string() }),
  z.object({ kind: z.literal('story') }),
]);

export const capturedMessageSchema = z.object({
  identityKey: z.string(),
  identitySource: z.enum(['externalId', 'externalUrl', 'contentHash']),
  fingerprint: z.string().nullable().default(null),
  externalId: z.string().nullable(),
  externalUrl: z.string().nullable(),
  collection: collectionInfoSchema,
  threadId: z.string(),
  messageId: z.string().nullable(),
  sender: messageSenderSchema.nullable(),
  displayedAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  sortKey: z.string(),
  text: z.string().nullable(),
  isReply: z.boolean().default(false),
  isUnsent: z.boolean().default(false),
  reactions: z.array(messageReactionSchema).default([]),
  attachments: z.array(messageAttachmentSchema).default([]),
  warnings: z.array(z.enum(MESSAGE_WARNINGS)).default([]),
  capturedAt: z.string(),
  updatedAt: z.string(),
});

export const scanOptionsSchema = z
  .object({
    captureReactions: z.boolean().default(true),
    captureAttachments: z.boolean().default(true),
    stopAtDate: z.string().nullable().default(null),
    stopAtMessageLimit: z.number().nullable().default(null),
  })
  .default({
    captureReactions: true,
    captureAttachments: true,
    stopAtDate: null,
    stopAtMessageLimit: null,
  });

export const capturedThreadSchema = z.object({
  threadId: z.string(),
  threadIdSource: z.enum(['threadTitle', 'vanity', 'numeric']),
  title: z.string().nullable(),
  aliases: z.array(z.string()).default([]),
  isEncryptedThread: z.boolean().default(false),
  messageCount: z.number().default(0),
  unresolvedTimestampCount: z.number().default(0),
  reachedThreadStart: z.boolean().default(false),
  lastStopReason: z.enum(SCAN_STOP_REASONS).nullable().default(null),
  firstScannedAt: z.string(),
  lastScannedAt: z.string(),
  oldestSentAt: z.string().nullable().default(null),
  newestSentAt: z.string().nullable().default(null),
});

export const captureProtocol = createCaptureProtocol<CapturedMessage, ScanOptions>({
  itemSchema: capturedMessageSchema,
  optionsSchema: scanOptionsSchema,
});

export const captureSessionSchema = captureProtocol.sessionSchema;

export type BackgroundRequest = CoreBackgroundRequest<CapturedMessage, ScanOptions>;
export type BackgroundResponse = CoreBackgroundResponse<ScanOptions>;
export type ContentRequest = CoreContentRequest<ScanOptions>;
export type ContentResponse = CoreContentResponse;

export const parseBackgroundRequest = captureProtocol.parseBackgroundRequest;
export const parseBackgroundResponse = captureProtocol.parseBackgroundResponse;
export const parseContentRequest = captureProtocol.parseContentRequest;
export const parseContentResponse = captureProtocol.parseContentResponse;
