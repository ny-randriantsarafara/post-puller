import type { ZodType, ZodTypeDef } from 'zod';

// Spelled with all three arguments on purpose: the one-argument ZodType<T> pins
// the input type to T, which rejects both .default() and z.preprocess. Every
// schema for stored data here needs at least one of them.
export type Schema<T> = ZodType<T, ZodTypeDef, unknown>;
