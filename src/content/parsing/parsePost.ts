import type { GroupInfo, ParsedPostDraft, PostAuthor, PostWarning } from '../../shared/types';
import {
  buildGroupPostUrl,
  extractPostIdFromElement,
  extractPostIdFromUrl,
  normalizePostUrl,
} from '../../shared/identity/postUrl';
import {
  detectRelativeDateLocale,
  parseRelativeDate,
} from '../../shared/time/relativeDate';
import {
  readAccessibleText,
  readReferencedSvgText,
  readTrimmedText,
} from './domText';
import { parseAttachment } from './parseAttachment';
import { parseComment } from './parseComment';
import { parseReactionCountFromElement } from './parseCount';
import {
  ANONYMOUS_AUTHOR_PATTERNS,
  COMPACT_RELATIVE_DATE,
  SEE_MORE_PATTERNS,
  SELECTORS,
  VIEW_MORE_COMMENTS_PATTERNS,
} from './selectors';

function findPostLink(element: Element): string | null {
  const postLinks = [...element.querySelectorAll(SELECTORS.link)].filter((link) => {
    const href = link.getAttribute('href');
    return (
      href !== null &&
      (href.includes('/permalink/') ||
        href.includes('/posts/') ||
        href.includes('story_fbid='))
    );
  });
  const preferredLink =
    postLinks.find((link) => {
      const href = link.getAttribute('href');
      return href !== null && !href.includes('comment_id=');
    }) ?? postLinks[0];

  if (preferredLink === undefined) {
    return null;
  }

  const href = preferredLink.getAttribute('href');
  return href === null ? null : new URL(href, 'https://www.facebook.com').toString();
}

function parsePostAuthor(element: Element): PostAuthor {
  const heading = element.querySelector('h2, h3, [role="heading"]');
  const headingButton = heading?.querySelector('[role="button"]') ?? null;
  const headingButtonText = readAccessibleText(headingButton);

  for (const pattern of ANONYMOUS_AUTHOR_PATTERNS) {
    if (pattern.test(headingButtonText)) {
      return {
        kind: 'anonymous',
        label: headingButtonText,
      };
    }
  }

  const authorLink = heading?.querySelector(
    `${SELECTORS.link}[href*="/user/"], ${SELECTORS.link}[href*="profile.php"], ${SELECTORS.link}[role="link"]`,
  );

  if (authorLink !== null && authorLink !== undefined) {
    const name = readAccessibleText(authorLink);
    if (name.length > 0) {
      const href = authorLink.getAttribute('href');
      const profileUrl =
        href === null ? null : new URL(href, 'https://www.facebook.com').toString();

      for (const pattern of ANONYMOUS_AUTHOR_PATTERNS) {
        if (pattern.test(name)) {
          return {
            kind: 'anonymous',
            label: name,
          };
        }
      }

      return {
        kind: 'named',
        name,
        profileUrl,
      };
    }
  }

  const headingText = readAccessibleText(heading);
  if (headingText.length > 0) {
    for (const pattern of ANONYMOUS_AUTHOR_PATTERNS) {
      if (pattern.test(headingText)) {
        return {
          kind: 'anonymous',
          label: headingText,
        };
      }
    }

    return {
      kind: 'named',
      name: headingText,
      profileUrl: null,
    };
  }

  return { kind: 'unknown' };
}

function hasSeeMoreButton(element: Element): boolean {
  const buttons = [...element.querySelectorAll(SELECTORS.postMessage)].flatMap(
    (messageElement) => [
      ...messageElement.querySelectorAll(SELECTORS.seeMoreButton),
    ],
  );

  for (const button of buttons) {
    const label = readTrimmedText(button);
    for (const pattern of SEE_MORE_PATTERNS) {
      if (pattern.test(label)) {
        return true;
      }
    }
  }

  return false;
}

function hasCollapsedComments(element: Element): boolean {
  const buttons = [...element.querySelectorAll(SELECTORS.seeMoreButton)];

  for (const button of buttons) {
    const label = readTrimmedText(button);
    for (const pattern of VIEW_MORE_COMMENTS_PATTERNS) {
      if (pattern.test(label)) {
        return true;
      }
    }
  }

  return false;
}

function parsePostText(element: Element): string | null {
  const textBlocks = [
    ...element.querySelectorAll(
      `${SELECTORS.postMessage}, ${SELECTORS.linkDescription}`,
    ),
  ]
    .map((messageElement) => {
      const clone = messageElement.cloneNode(true);
      if (!(clone instanceof Element)) {
        return '';
      }

      for (const button of clone.querySelectorAll(SELECTORS.seeMoreButton)) {
        const label = readTrimmedText(button);
        if (SEE_MORE_PATTERNS.some((pattern) => pattern.test(label))) {
          button.remove();
        }
      }

      return readTrimmedText(clone).replace(/\s+/g, ' ').trim();
    })
    .filter((value) => value.length > 0);

  if (textBlocks.length === 0) {
    return null;
  }

  return [...new Set(textBlocks)].join('\n');
}

function findPostCardContainer(postElement: Element): Element {
  let current: Element | null = postElement;

  while (current.parentElement !== null) {
    const parent: Element = current.parentElement;
    const storiesInParent = parent.querySelectorAll(SELECTORS.postRoot);
    if (storiesInParent.length === 1 && storiesInParent[0] === postElement) {
      return parent;
    }

    current = parent;
  }

  return postElement;
}

function getPostDateSearchRoot(postElement: Element): Element {
  const heading = postElement.querySelector('h2, h3, [role="heading"]');
  if (heading === null) {
    return postElement;
  }

  const parent = heading.parentElement;
  if (parent === null) {
    return postElement;
  }

  const grandParent = parent.parentElement;
  if (grandParent === null) {
    return parent;
  }

  return grandParent;
}

function isLikelyPostTimestamp(
  text: string,
  locale: ReturnType<typeof detectRelativeDateLocale>,
): boolean {
  if (/^\d+$/.test(text)) {
    return false;
  }

  if (COMPACT_RELATIVE_DATE.test(text)) {
    return true;
  }

  if (!/[a-zA-Zàâäéèêëïîôùûüç]/i.test(text)) {
    return false;
  }

  return isParseableRelativeDate(text, locale);
}

function findLeafTimestamp(
  postElement: Element,
  searchRoots: Element[],
  locale: ReturnType<typeof detectRelativeDateLocale>,
): string | null {
  for (const searchRoot of searchRoots) {
    for (const candidate of searchRoot.querySelectorAll('*')) {
      if (!(candidate instanceof Element) || isInsideNestedComment(postElement, candidate)) {
        continue;
      }

      if (candidate.children.length > 0) {
        continue;
      }

      const text = readTrimmedText(candidate);
      if (text.length === 0) {
        continue;
      }

      if (COMPACT_RELATIVE_DATE.test(text)) {
        return text;
      }
    }
  }

  for (const searchRoot of searchRoots) {
    for (const candidate of searchRoot.querySelectorAll('*')) {
      if (!(candidate instanceof Element) || isInsideNestedComment(postElement, candidate)) {
        continue;
      }

      if (candidate.children.length > 0) {
        continue;
      }

      const text = readTrimmedText(candidate);
      if (isLikelyPostTimestamp(text, locale)) {
        return text;
      }
    }
  }

  return null;
}

function isParseableRelativeDate(
  rawValue: string,
  locale: ReturnType<typeof detectRelativeDateLocale>,
): boolean {
  if (parseRelativeDate(rawValue, new Date(), locale).warning === null) {
    return true;
  }

  const alternateLocale = locale === 'en' ? 'fr' : 'en';
  return parseRelativeDate(rawValue, new Date(), alternateLocale).warning === null;
}

function findDisplayedDate(
  postElement: Element,
  locale: ReturnType<typeof detectRelativeDateLocale>,
): string | null {
  const timeElement = postElement.querySelector(SELECTORS.time);
  const datetimeAttribute =
    timeElement === null ? null : timeElement.getAttribute('datetime');
  if (datetimeAttribute !== null && datetimeAttribute.length > 0) {
    return datetimeAttribute;
  }

  const searchRoots = [
    getPostDateSearchRoot(postElement),
    findPostCardContainer(postElement),
    postElement,
  ];

  for (const searchRoot of searchRoots) {
    for (const abbr of searchRoot.querySelectorAll(SELECTORS.timestampAbbr)) {
      if (!(abbr instanceof Element) || isInsideNestedComment(postElement, abbr)) {
        continue;
      }

      const label = abbr.getAttribute('aria-label')?.trim() ?? '';
      if (label.length > 0 && isParseableRelativeDate(label, locale)) {
        return label;
      }
    }
  }

  const postLink = [
    ...postElement.querySelectorAll('a[href*="/groups/"][href*="/posts/"]'),
  ].find((link) => link.getAttribute('href')?.includes('comment_id=') !== true);
  const linkedDate =
    postLink?.getAttribute('aria-label')?.trim() ??
    postLink?.getAttribute('title')?.trim() ??
    readReferencedSvgText(postLink ?? null);
  if (linkedDate.length > 0 && isParseableRelativeDate(linkedDate, locale)) {
    return linkedDate;
  }

  for (const searchRoot of searchRoots) {
    const leafTimestamp = findLeafTimestamp(postElement, [searchRoot], locale);
    if (leafTimestamp !== null) {
      return leafTimestamp;
    }
  }

  return null;
}

function parsePostDate(element: Element): {
  displayedDate: string | null;
  publishedAt: string | null;
  warnings: PostWarning[];
} {
  const locale = detectRelativeDateLocale(document.documentElement.lang);
  const displayedDate = findDisplayedDate(element, locale);

  if (displayedDate === null) {
    return {
      displayedDate: null,
      publishedAt: null,
      warnings: ['MISSING_DATE'],
    };
  }

  const parsedDate = parseRelativeDate(displayedDate, new Date(), locale);
  const warnings: PostWarning[] = [];

  if (parsedDate.warning !== null) {
    warnings.push(parsedDate.warning);
  }

  return {
    displayedDate,
    publishedAt: parsedDate.publishedAt,
    warnings,
  };
}

function isInsideNestedComment(postElement: Element, element: Element): boolean {
  const nearestComment = element.closest(SELECTORS.commentArticle);
  if (nearestComment === null) {
    return false;
  }

  return postElement.contains(nearestComment);
}

function parsePostReactionCount(postElement: Element): number | null {
  const candidates = [...postElement.querySelectorAll('[aria-label]')].filter(
    (element) => !isInsideNestedComment(postElement, element),
  );

  for (const candidate of candidates) {
    const label = candidate.getAttribute('aria-label') ?? '';
    if (!/reactions?|réactions?|^like:/i.test(label)) {
      continue;
    }

    const reactionCount = parseReactionCountFromElement(candidate);
    if (reactionCount !== null) {
      return reactionCount;
    }
  }

  return null;
}

function parseVisibleComments(postElement: Element): ParsedPostDraft['comments'] {
  const cometComments = [
    ...postElement.querySelectorAll(SELECTORS.commentArticle),
  ];
  const nestedArticles =
    cometComments.length > 0
      ? cometComments
      : [...postElement.querySelectorAll(SELECTORS.article)].filter(
          (article) => article !== postElement,
        );

  return nestedArticles.map((commentElement) => parseComment(commentElement));
}

export function parsePost(
  postElement: Element,
  group: GroupInfo,
): ParsedPostDraft {
  const warnings: PostWarning[] = [];
  const rawPostUrl = findPostLink(postElement);
  const postId =
    extractPostIdFromElement(postElement) ?? extractPostIdFromUrl(rawPostUrl);
  const postUrl =
    postId === null
      ? normalizePostUrl(rawPostUrl)
      : buildGroupPostUrl(group.url, postId);
  const author = parsePostAuthor(postElement);
  const text = parsePostText(postElement);
  const date = parsePostDate(postElement);
  const reactionCount = parsePostReactionCount(postElement);
  const attachment = parseAttachment(postElement);
  const comments = parseVisibleComments(postElement);

  warnings.push(...date.warnings);

  if (postId === null) {
    warnings.push('MISSING_POST_ID');
  }

  if (postUrl === null) {
    warnings.push('MISSING_POST_URL');
  }

  if (author.kind === 'unknown') {
    warnings.push('MISSING_AUTHOR');
  }

  if (text === null) {
    warnings.push('MISSING_TEXT');
  }

  if (hasSeeMoreButton(postElement)) {
    warnings.push('TRUNCATED_TEXT');
  }

  if (reactionCount === null) {
    warnings.push('MISSING_REACTION_COUNT');
  }

  if (hasCollapsedComments(postElement)) {
    warnings.push('COLLAPSED_COMMENTS');
  }

  if (comments.length === 0 && hasCollapsedComments(postElement)) {
    warnings.push('HIDDEN_COMMENTS');
  }

  if (attachment.kind === 'unknown') {
    warnings.push('UNKNOWN_ATTACHMENT');
  }

  return {
    postId,
    postUrl,
    group,
    author,
    text,
    displayedDate: date.displayedDate,
    publishedAt: date.publishedAt,
    reactionCount,
    comments,
    attachments: [attachment],
    warnings,
  };
}
