export {
  buildHashInput,
  createContentHash,
  normalizeWhitespace,
  sha256Hex,
} from './contentHash';
export {
  createFingerprint,
  resolveStableTextPrefix,
  type StableTextPrefixPolicy,
} from './fingerprint';
export {
  isStrongerIdentity,
  resolveItemIdentity,
  retainCapturedIdentity,
  type IdentityInput,
  type ResolvedIdentity,
} from './itemIdentity';
