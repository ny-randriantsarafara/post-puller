import { describe, expect, it } from 'vitest';
import { createPostFingerprint } from './postFingerprint';

const TRUNCATED_TEXT =
  'Looking for a freelance developer to help with a small React proje…';
const EXPANDED_TEXT =
  'Looking for a freelance developer to help with a small React project this month';

describe('createPostFingerprint', () => {
  it('stays stable when See more reveals the rest of the message', async () => {
    const truncated = await createPostFingerprint({
      authorLabel: 'Jane Doe',
      text: TRUNCATED_TEXT,
    });
    const expanded = await createPostFingerprint({
      authorLabel: 'Jane Doe',
      text: EXPANDED_TEXT,
    });

    expect(truncated).not.toBeNull();
    expect(expanded).toBe(truncated);
  });

  it('ignores whitespace differences between two renders', async () => {
    const compact = await createPostFingerprint({
      authorLabel: 'Jane Doe',
      text: EXPANDED_TEXT,
    });
    const spaced = await createPostFingerprint({
      authorLabel: '  Jane   Doe ',
      text: EXPANDED_TEXT.replace(/ /g, '\n  '),
    });

    expect(spaced).toBe(compact);
  });

  it('separates two authors posting the same message', async () => {
    const first = await createPostFingerprint({
      authorLabel: 'Jane Doe',
      text: EXPANDED_TEXT,
    });
    const second = await createPostFingerprint({
      authorLabel: 'John Smith',
      text: EXPANDED_TEXT,
    });

    expect(second).not.toBe(first);
  });

  it('separates two messages that differ inside the fingerprinted prefix', async () => {
    const first = await createPostFingerprint({
      authorLabel: 'Jane Doe',
      text: EXPANDED_TEXT,
    });
    const second = await createPostFingerprint({
      authorLabel: 'Jane Doe',
      text: EXPANDED_TEXT.replace('React', 'Vue.js'),
    });

    expect(second).not.toBe(first);
  });

  it('refuses a message too short to be proven stable', async () => {
    const fingerprint = await createPostFingerprint({
      authorLabel: 'Jane Doe',
      text: 'Anyone available today?',
    });

    expect(fingerprint).toBeNull();
  });

  it('refuses a post with no text', async () => {
    const fingerprint = await createPostFingerprint({
      authorLabel: 'Jane Doe',
      text: null,
    });

    expect(fingerprint).toBeNull();
  });
});
