import { z } from 'zod';
import { SCAN_STOP_REASONS } from '../types/thread';
import { capturedThreadSchema } from './protocol';

// Messages that have no equivalent in the generic protocol, because they exist
// for a decision only Messenger has to make: which thread id a scan writes
// under, and what a finished scan recorded about the thread.
//
// Storage lives in the service worker - a content script's indexedDB belongs to
// the page, not to the extension - so the content script has to ask for the
// canonical id rather than resolving it itself.
export const threadRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('RESOLVE_CANONICAL_THREAD_ID'),
    candidateIds: z.array(z.string()),
  }),
  z.object({
    type: z.literal('RECORD_THREAD_SCAN'),
    threadId: z.string(),
    aliases: z.array(z.string()).default([]),
    title: z.string().nullable().default(null),
    isEncryptedThread: z.boolean().default(false),
    stopReason: z.enum(SCAN_STOP_REASONS).nullable().default(null),
  }),
]);

export type ThreadRequest = z.infer<typeof threadRequestSchema>;

export const threadResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('CANONICAL_THREAD_ID'),
    threadId: z.string(),
  }),
  z.object({
    type: z.literal('THREAD_RECORDED'),
    thread: capturedThreadSchema,
  }),
  z.object({
    type: z.literal('ERROR'),
    message: z.string(),
  }),
]);

export type ThreadResponse = z.infer<typeof threadResponseSchema>;

export function isThreadRequest(message: unknown): boolean {
  return threadRequestSchema.safeParse(message).success;
}
