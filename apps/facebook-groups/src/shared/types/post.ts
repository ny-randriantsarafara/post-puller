import type { CapturedComment } from './comment';
import type { ReactionBreakdown } from './reactions';
import type { PostWarning } from './warnings';

export type PostAuthor =
  | { kind: 'named'; name: string; profileUrl: string | null }
  | { kind: 'anonymous'; label: string }
  | { kind: 'unknown' };

export type Attachment =
  | { kind: 'image' | 'video' | 'link' | 'sharedPost'; url: string | null }
  | { kind: 'none' }
  | { kind: 'unknown' };

export type GroupInfo = {
  name: string | null;
  url: string;
};

export type IdentitySource = 'postId' | 'postUrl' | 'contentHash';

export type CapturedPost = {
  identityKey: string;
  identitySource: IdentitySource;
  // Stable across re-sightings of the same post, unlike identityKey, which
  // changes when Facebook reveals more text or ages the relative date label.
  fingerprint: string | null;
  postId: string | null;
  postUrl: string | null;
  group: GroupInfo;
  author: PostAuthor;
  text: string | null;
  displayedDate: string | null;
  publishedAt: string | null;
  reactionCount: number | null;
  reactionBreakdown: ReactionBreakdown;
  commentCount: number | null;
  shareCount: number | null;
  comments: CapturedComment[];
  attachments: Attachment[];
  capturedAt: string;
  updatedAt: string;
  warnings: PostWarning[];
};

export type ParsedPostDraft = Omit<
  CapturedPost,
  'identityKey' | 'identitySource' | 'fingerprint' | 'capturedAt' | 'updatedAt'
>;
