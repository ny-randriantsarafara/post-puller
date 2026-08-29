import {
  createWindowScrollTarget,
  type SiteAdapter,
} from '@extractor/capture-core/content';
import { isBetterCapturedPost } from '../shared/captureQuality';
import {
  finalizeCapturedPost,
  retainCapturedIdentity,
} from '../shared/identity/postIdentity';
import type { CapturedPost } from '../shared/types';
import type { CaptureOptions } from '../shared/types/captureOptions';
import { clickCommentExpansionControls } from './expandComments';
import { clickPostTextExpansionControls } from './expandPostText';
import { resolvePageTarget } from './groupPage';
import { parsePost } from './parsing/parsePost';
import { SELECTORS } from './parsing/selectors';
import {
  findContainingPostRoot,
  findRenderedPostRoots,
  isCapturablePostRoot,
} from './postRoots';

const MAX_EXPANSION_CLICKS_PER_POST = 3;

export const facebookSiteAdapter: SiteAdapter<CapturedPost, CaptureOptions> = {
  resolvePageTarget: () => resolvePageTarget(),
  // The window scrolls the group feed, so body is a correct fallback here in a
  // way it would not be for a panel that scrolls on its own.
  resolveObservedRoot: () => document.querySelector(SELECTORS.feed) ?? document.body,
  findRenderedItemRoots: findRenderedPostRoots,
  findContainingItemRoot: findContainingPostRoot,
  isCapturableItemRoot: isCapturablePostRoot,
  captureItem: (itemRoot, collection, options, capturedAt) =>
    finalizeCapturedPost(parsePost(itemRoot, collection, options), itemRoot, capturedAt),
  retainIdentity: retainCapturedIdentity,
  isBetterCapture: isBetterCapturedPost,
  resolveScrollTarget: () => createWindowScrollTarget('down'),
  expansions: [
    {
      name: 'postText',
      maxClicksPerItem: MAX_EXPANSION_CLICKS_PER_POST,
      isEnabled: (options) => options.expandPostText,
      needsExpansion: (post) => post.warnings.includes('TRUNCATED_TEXT'),
      click: clickPostTextExpansionControls,
    },
    {
      name: 'comments',
      maxClicksPerItem: MAX_EXPANSION_CLICKS_PER_POST,
      isEnabled: (options) => options.expandComments,
      needsExpansion: (post) =>
        post.warnings.includes('COLLAPSED_COMMENTS') ||
        post.warnings.includes('MISSING_COMMENTS'),
      click: clickCommentExpansionControls,
    },
  ],
};
