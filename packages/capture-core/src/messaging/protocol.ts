import { z } from 'zod';
import type { Schema } from '../domain/schema';
import type { ScanStats } from '../domain/stats';
import {
  captureModeSchema,
  createCaptureSessionSchema,
  scanStatsSchema,
  type CaptureMode,
  type CaptureSession,
} from './session';

// The four unions are written by hand rather than inferred from the schemas.
// Inferring them would make every downstream signature depend on what zod
// happens to widen a generic parameter to, and a mistake there surfaces as an
// error in an unrelated file.
export type BackgroundRequest<TItem, TOptions extends object> =
  | { type: 'GET_SESSION' }
  | { type: 'START_CAPTURE'; tabId: number; mode: CaptureMode; options: TOptions }
  | { type: 'STOP_CAPTURE' }
  | { type: 'CLEAR_DATA' }
  | { type: 'CLEAR_COLLECTION_DATA'; collectionUrl: string }
  | { type: 'ITEMS_CAPTURED'; tabId: number; items: TItem[] }
  // Sent once per batch, including the batch that read nothing at all: a scan
  // whose items are all recycled before it reaches them sends no ITEMS_CAPTURED
  // and would otherwise be indistinguishable from a scan with nothing to read.
  | { type: 'ITEMS_SEEN'; tabId: number; stats: ScanStats }
  | { type: 'CAPTURE_INTERRUPTED'; tabId: number }
  | { type: 'AUTO_SCROLL_COMPLETED'; tabId: number };

export type BackgroundResponse<TOptions extends object> =
  | { type: 'SESSION'; session: CaptureSession<TOptions> }
  | { type: 'ERROR'; message: string }
  | { type: 'SUCCESS'; session: CaptureSession<TOptions> };

export type ContentRequest<TOptions extends object> =
  | { type: 'BEGIN_CAPTURE'; mode: CaptureMode; options: TOptions }
  | { type: 'END_CAPTURE' }
  | { type: 'GET_PAGE_INFO' };

export type ContentResponse =
  | {
      type: 'PAGE_INFO';
      isTargetPage: boolean;
      collectionName: string | null;
      collectionUrl: string | null;
    }
  | { type: 'CAPTURE_STATE'; isCapturing: boolean }
  | { type: 'ERROR'; message: string };

// Envelopes validate everything except the two payloads whose type the domain
// owns: the captured items and the options. Those stay unknown here and are
// parsed with the domain's schemas below, which keeps zod's inference free of
// the type parameters. Embedding them makes zod treat the field as optional,
// because it cannot prove undefined is not a member of an unresolved parameter.
const backgroundRequestEnvelopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('GET_SESSION') }),
  z.object({
    type: z.literal('START_CAPTURE'),
    tabId: z.number(),
    mode: captureModeSchema,
    options: z.unknown(),
  }),
  z.object({ type: z.literal('STOP_CAPTURE') }),
  z.object({ type: z.literal('CLEAR_DATA') }),
  z.object({
    type: z.literal('CLEAR_COLLECTION_DATA'),
    collectionUrl: z.string(),
  }),
  z.object({
    type: z.literal('ITEMS_CAPTURED'),
    tabId: z.number(),
    items: z.array(z.unknown()),
  }),
  z.object({
    type: z.literal('ITEMS_SEEN'),
    tabId: z.number(),
    stats: scanStatsSchema,
  }),
  z.object({ type: z.literal('CAPTURE_INTERRUPTED'), tabId: z.number() }),
  z.object({ type: z.literal('AUTO_SCROLL_COMPLETED'), tabId: z.number() }),
]);

const backgroundResponseEnvelopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SESSION'), session: z.unknown() }),
  z.object({ type: z.literal('ERROR'), message: z.string() }),
  z.object({ type: z.literal('SUCCESS'), session: z.unknown() }),
]);

const contentRequestEnvelopeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('BEGIN_CAPTURE'),
    mode: captureModeSchema,
    options: z.unknown(),
  }),
  z.object({ type: z.literal('END_CAPTURE') }),
  z.object({ type: z.literal('GET_PAGE_INFO') }),
]);

const contentResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('PAGE_INFO'),
    isTargetPage: z.boolean(),
    collectionName: z.string().nullable(),
    collectionUrl: z.string().nullable(),
  }),
  z.object({ type: z.literal('CAPTURE_STATE'), isCapturing: z.boolean() }),
  z.object({ type: z.literal('ERROR'), message: z.string() }),
]);

export type CaptureProtocol<TItem, TOptions extends object> = {
  readonly sessionSchema: Schema<CaptureSession<TOptions>>;
  parseBackgroundRequest: (value: unknown) => BackgroundRequest<TItem, TOptions>;
  parseBackgroundResponse: (value: unknown) => BackgroundResponse<TOptions>;
  parseContentRequest: (value: unknown) => ContentRequest<TOptions>;
  parseContentResponse: (value: unknown) => ContentResponse;
};

export type CaptureProtocolConfig<TItem, TOptions extends object> = {
  readonly itemSchema: Schema<TItem>;
  readonly optionsSchema: Schema<TOptions>;
  // Runs before validation, so a session persisted by an older build can be
  // reshaped instead of being discarded as unparseable.
  readonly migrateSession?: (value: unknown) => unknown;
};

export function createCaptureProtocol<TItem, TOptions extends object>({
  itemSchema,
  optionsSchema,
  migrateSession,
}: CaptureProtocolConfig<TItem, TOptions>): CaptureProtocol<TItem, TOptions> {
  const sessionSchema = createCaptureSessionSchema(optionsSchema, migrateSession);

  function parseBackgroundRequest(value: unknown): BackgroundRequest<TItem, TOptions> {
    const envelope = backgroundRequestEnvelopeSchema.parse(value);

    switch (envelope.type) {
      case 'GET_SESSION':
      case 'STOP_CAPTURE':
      case 'CLEAR_DATA':
        return { type: envelope.type };
      case 'START_CAPTURE':
        return {
          type: 'START_CAPTURE',
          tabId: envelope.tabId,
          mode: envelope.mode,
          options: optionsSchema.parse(envelope.options),
        };
      case 'CLEAR_COLLECTION_DATA':
        return {
          type: 'CLEAR_COLLECTION_DATA',
          collectionUrl: envelope.collectionUrl,
        };
      case 'ITEMS_CAPTURED':
        return {
          type: 'ITEMS_CAPTURED',
          tabId: envelope.tabId,
          items: envelope.items.map((item) => itemSchema.parse(item)),
        };
      case 'ITEMS_SEEN':
        return {
          type: 'ITEMS_SEEN',
          tabId: envelope.tabId,
          stats: envelope.stats,
        };
      case 'CAPTURE_INTERRUPTED':
        return { type: 'CAPTURE_INTERRUPTED', tabId: envelope.tabId };
      case 'AUTO_SCROLL_COMPLETED':
        return { type: 'AUTO_SCROLL_COMPLETED', tabId: envelope.tabId };
      default: {
        const unhandled: never = envelope;
        throw new Error(`Unhandled background request: ${String(unhandled)}`);
      }
    }
  }

  function parseBackgroundResponse(value: unknown): BackgroundResponse<TOptions> {
    const envelope = backgroundResponseEnvelopeSchema.parse(value);

    switch (envelope.type) {
      case 'SESSION':
        return { type: 'SESSION', session: sessionSchema.parse(envelope.session) };
      case 'SUCCESS':
        return { type: 'SUCCESS', session: sessionSchema.parse(envelope.session) };
      case 'ERROR':
        return { type: 'ERROR', message: envelope.message };
      default: {
        const unhandled: never = envelope;
        throw new Error(`Unhandled background response: ${String(unhandled)}`);
      }
    }
  }

  function parseContentRequest(value: unknown): ContentRequest<TOptions> {
    const envelope = contentRequestEnvelopeSchema.parse(value);

    switch (envelope.type) {
      case 'BEGIN_CAPTURE':
        return {
          type: 'BEGIN_CAPTURE',
          mode: envelope.mode,
          options: optionsSchema.parse(envelope.options),
        };
      case 'END_CAPTURE':
      case 'GET_PAGE_INFO':
        return { type: envelope.type };
      default: {
        const unhandled: never = envelope;
        throw new Error(`Unhandled content request: ${String(unhandled)}`);
      }
    }
  }

  return {
    sessionSchema,
    parseBackgroundRequest,
    parseBackgroundResponse,
    parseContentRequest,
    parseContentResponse: (value) => contentResponseSchema.parse(value),
  };
}
