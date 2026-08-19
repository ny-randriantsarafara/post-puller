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
  /view previous comments/i,
  /voir plus de commentaires/i,
  /afficher plus de commentaires/i,
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

export const COMMENT_REACTION_ARIA_PATTERNS = [
  /(\d[\d,.\s]*)\s+likes?/i,
  /(\d[\d,.\s]*)\s+j'aime/i,
];
