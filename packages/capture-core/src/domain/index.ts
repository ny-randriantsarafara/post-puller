export type { CaptureDomain } from './captureDomain';
export type { CollectionInfo } from './collection';
export {
  buildIdentityKey,
  IDENTITY_STRENGTH,
  isStrongerIdentitySource,
  type IdentityKeyPrefixes,
  type IdentitySource,
} from './identity';
export type { CapturedItemBase } from './item';
export { isIncompleteItem, type ItemProjection } from './projection';
export type { Schema } from './schema';
export {
  addScanStats,
  EMPTY_SCAN_STATS,
  judgeScanStats,
  type ScanStats,
  type ScanStatsVerdict,
} from './stats';
export type { StorageConfig } from './storage';
