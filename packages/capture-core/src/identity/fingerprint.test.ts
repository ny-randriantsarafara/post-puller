import { describe, expect, it } from 'vitest';
import { resolveStableTextPrefix, type StableTextPrefixPolicy } from './fingerprint';

const POLICY: StableTextPrefixPolicy = { minimumLength: 20, prefixLength: 20 };

describe('resolveStableTextPrefix', () => {
  it('refuses a text too short to be proven stable', () => {
    expect(resolveStableTextPrefix('too short', POLICY)).toBeNull();
    expect(resolveStableTextPrefix(null, POLICY)).toBeNull();
  });

  it('returns the same prefix before and after the site reveals the rest', () => {
    const truncated = resolveStableTextPrefix(
      'A long enough opening line…',
      POLICY,
    );
    const revealed = resolveStableTextPrefix(
      'A long enough opening line, followed by everything else.',
      POLICY,
    );

    expect(truncated).toBe(revealed);
  });

  it('ignores whitespace differences between two sightings', () => {
    expect(resolveStableTextPrefix('A  long   enough opening line', POLICY)).toBe(
      resolveStableTextPrefix('A long enough opening line', POLICY),
    );
  });

  it('drops a trailing ellipsis written either way', () => {
    expect(resolveStableTextPrefix('A long enough opening...', POLICY)).toBe(
      resolveStableTextPrefix('A long enough opening…', POLICY),
    );
  });

  it('measures the minimum on the text left after the ellipsis is dropped', () => {
    // "nineteen characters" is 19 long once the ellipsis goes, so a policy with a
    // minimum of 20 must refuse it rather than count the ellipsis towards it.
    expect(resolveStableTextPrefix('nineteen characters…', POLICY)).toBeNull();
  });
});
