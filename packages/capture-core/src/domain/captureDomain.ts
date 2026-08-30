import type { IdentityKeyPrefixes } from './identity';
import type { CapturedItemBase } from './item';
import type { ItemProjection } from './projection';
import type { Schema } from './schema';
import type { StorageConfig } from './storage';

// The half of a site definition that holds no DOM query and touches no chrome
// API, so the background worker, the popup and the preview page can all import
// it. The DOM half is SiteAdapter, which only the content script sees.
export type CaptureDomain<
  TItem extends CapturedItemBase,
  TOptions extends object,
> = {
  readonly id: string;
  readonly itemSchema: Schema<TItem>;
  readonly optionsSchema: Schema<TOptions>;
  readonly defaultOptions: TOptions;
  readonly storage: StorageConfig;
  readonly identityKeyPrefixes: IdentityKeyPrefixes;
  readonly projection: ItemProjection<TItem>;
  isTargetUrl: (url: string) => boolean;
  isBetterCapture: (existing: TItem, incoming: TItem) => boolean;
  mergeCapture: (existing: TItem, incoming: TItem) => TItem;
  // Rejects items whose identity degenerates to a value shared with unrelated
  // items, which would otherwise overwrite each other under one key.
  isIdentifiable: (item: TItem) => boolean;
};
