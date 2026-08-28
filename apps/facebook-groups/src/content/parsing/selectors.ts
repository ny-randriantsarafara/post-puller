import type { ReactionType } from '../../shared/types/reactions';

export const SELECTORS = {
  feed: '[role="feed"]',
  postRoot: '[data-focus="feed_story"]',
  postMessage:
    '[data-ad-preview="message"], [data-ad-rendering-role="story_message"]',
  linkDescription: '[data-ad-rendering-role="description"]',
  renderedPostContent:
    '[data-ad-preview="message"], [data-ad-rendering-role="story_message"], a[href*="/groups/"][href*="/posts/"]',
  article: '[role="article"]',
  commentArticle:
    '[role="article"][aria-label^="Comment by "], [role="article"][aria-label^="Commentaire de "]',
  heading: '[role="heading"]',
  link: 'a[href]',
  time: 'time',
  timestampAbbr: 'abbr[aria-label]',
  image: 'img',
  video: 'video',
  seeMoreButton: '[role="button"]',
  commentWrapper: '[data-commentid]',
  likeButton: '[data-ad-rendering-role="like_button"]',
  commentButton: '[data-ad-rendering-role="comment_button"]',
  shareButton: '[data-ad-rendering-role="share_button"]',
} as const;

export const COMPACT_RELATIVE_DATE = /^(\d+\s*(?:s|m|h|d|w|mo|y|min|j|sem|mois))$/i;

export const SEE_MORE_PATTERNS = [
  /^see more$/i,
  /^voir plus$/i,
  /^afficher la suite$/i,
  /^…\s*see more$/i,
];

export const VIEW_MORE_COMMENTS_PATTERNS = [
  /view more comments/i,
  /view more answers/i,
  /view previous comments/i,
  /voir plus de commentaires/i,
  /afficher plus de commentaires/i,
];

export const VIEW_REPLIES_PATTERNS = [
  /view all \d+ replies/i,
  /view \d+ repl(?:y|ies)/i,
  /voir les \d+ réponses/i,
  /voir \d+ réponse/i,
];

export const ANONYMOUS_AUTHOR_PATTERNS = [
  /^anonymous member$/i,
  /^membre anonyme$/i,
];

export const REACTION_ARIA_PATTERNS = [
  /^like:\s*(\d[\d,.\s]*)\s+people$/i,
  /(\d[\d,.\s]*)\s+reactions?/i,
  /(\d[\d,.\s]*)\s+réactions?/i,
];

export const REACTION_TYPE_ARIA_PATTERNS: Array<{
  reactionType: ReactionType;
  pattern: RegExp;
}> = [
  { reactionType: 'like', pattern: /^Like:\s*(\d[\d,.\s]*)\s+(?:people|person)$/i },
  { reactionType: 'like', pattern: /^J['']aime\s*:\s*(\d[\d,.\s]*)\s+(?:personnes?|people|person)$/i },
  { reactionType: 'love', pattern: /^Love:\s*(\d[\d,.\s]*)\s+(?:people|person)$/i },
  { reactionType: 'love', pattern: /^J['']adore\s*:\s*(\d[\d,.\s]*)\s+(?:personnes?|people|person)$/i },
  { reactionType: 'care', pattern: /^Care:\s*(\d[\d,.\s]*)\s+(?:people|person)$/i },
  { reactionType: 'care', pattern: /^Solidaire\s*:\s*(\d[\d,.\s]*)\s+(?:personnes?|people|person)$/i },
  { reactionType: 'haha', pattern: /^Haha:\s*(\d[\d,.\s]*)\s+(?:people|person)$/i },
  { reactionType: 'wow', pattern: /^Wow:\s*(\d[\d,.\s]*)\s+(?:people|person)$/i },
  { reactionType: 'wow', pattern: /^Wouah\s*:\s*(\d[\d,.\s]*)\s+(?:personnes?|people|person)$/i },
  { reactionType: 'sad', pattern: /^Sad:\s*(\d[\d,.\s]*)\s+(?:people|person)$/i },
  { reactionType: 'sad', pattern: /^Triste\s*:\s*(\d[\d,.\s]*)\s+(?:personnes?|people|person)$/i },
  { reactionType: 'angry', pattern: /^Angry:\s*(\d[\d,.\s]*)\s+(?:people|person)$/i },
  { reactionType: 'angry', pattern: /^Grrr\s*:\s*(\d[\d,.\s]*)\s+(?:personnes?|people|person)$/i },
];

export const COMMENT_REACTION_ARIA_PATTERNS = [
  /(\d[\d,.\s]*)\s+likes?/i,
  /(\d[\d,.\s]*)\s+j'aime/i,
];
