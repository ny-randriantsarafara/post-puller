import type { CommentWarning, PostAuthor } from '../../shared/types';
import {
  detectRelativeDateLocale,
  parseRelativeDate,
} from '../../shared/time/relativeDate';
import { readTrimmedText } from './domText';
import { parseCommentReactionCount } from './parseCount';
import { SELECTORS, ANONYMOUS_AUTHOR_PATTERNS } from './selectors';

export type ParsedComment = {
  author: PostAuthor;
  text: string | null;
  displayedDate: string | null;
  publishedAt: string | null;
  reactionCount: number | null;
  warnings: CommentWarning[];
};

type CommentAriaMetadata = {
  authorLabel: string | null;
  displayedDate: string | null;
};

function parseCommentAriaMetadata(element: Element): CommentAriaMetadata {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel === null) {
    return { authorLabel: null, displayedDate: null };
  }

  const englishMatch =
    /^Comment by (.+?) ((?:(?:\d+|a|an) (?:minute|hour|day|week|month|year)s? ago)|yesterday)$/i.exec(
      ariaLabel,
    );
  if (englishMatch?.[1] !== undefined && englishMatch[2] !== undefined) {
    return {
      authorLabel: englishMatch[1].trim(),
      displayedDate: englishMatch[2].trim(),
    };
  }

  const frenchMatch =
    /^Commentaire de (.+?) ((?:il y a \d+ (?:minutes?|heures?|jours?|semaines?|mois|ans?))|hier)$/i.exec(
      ariaLabel,
    );
  if (frenchMatch?.[1] !== undefined && frenchMatch[2] !== undefined) {
    return {
      authorLabel: frenchMatch[1].trim(),
      displayedDate: frenchMatch[2].trim(),
    };
  }

  return { authorLabel: null, displayedDate: null };
}

function parseCommentAuthor(element: Element): PostAuthor {
  const authorLink = element.querySelector(`${SELECTORS.link}[href*="/user/"], ${SELECTORS.link}[href*="profile.php"]`);
  if (authorLink !== null) {
    const name = readTrimmedText(authorLink);
    if (name.length > 0) {
      const href = authorLink.getAttribute('href');
      const profileUrl =
        href === null ? null : new URL(href, 'https://www.facebook.com').toString();
      return {
        kind: 'named',
        name,
        profileUrl,
      };
    }
  }

  const heading = element.querySelector(SELECTORS.heading);
  const headingText = readTrimmedText(heading);
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

  const ariaAuthor = parseCommentAriaMetadata(element).authorLabel;
  if (ariaAuthor !== null) {
    for (const pattern of ANONYMOUS_AUTHOR_PATTERNS) {
      if (pattern.test(ariaAuthor)) {
        return {
          kind: 'anonymous',
          label: ariaAuthor,
        };
      }
    }

    return {
      kind: 'named',
      name: ariaAuthor,
      profileUrl: null,
    };
  }

  return { kind: 'unknown' };
}

function parseCommentText(element: Element): string | null {
  const textBlocks = [...element.querySelectorAll('[dir="auto"]')]
    .map((node) => readTrimmedText(node))
    .filter((value) => value.length > 0);

  if (textBlocks.length === 0) {
    return null;
  }

  return textBlocks.join('\n');
}

function parseCommentDate(element: Element): {
  displayedDate: string | null;
  publishedAt: string | null;
  warnings: CommentWarning[];
} {
  const timeElement = element.querySelector(SELECTORS.time);
  const datetimeAttribute =
    timeElement === null ? null : timeElement.getAttribute('datetime');
  const timeText = readTrimmedText(timeElement);
  const ariaDate = parseCommentAriaMetadata(element).displayedDate;
  const displayedDate =
    datetimeAttribute === null || datetimeAttribute.length === 0
      ? timeText.length === 0
        ? ariaDate
        : timeText
      : datetimeAttribute;

  if (displayedDate === null) {
    return {
      displayedDate: null,
      publishedAt: null,
      warnings: ['MISSING_DATE'],
    };
  }

  const locale = detectRelativeDateLocale(document.documentElement.lang);
  const parsedDate = parseRelativeDate(displayedDate, new Date(), locale);
  const warnings: CommentWarning[] = [];

  if (parsedDate.warning !== null) {
    warnings.push(parsedDate.warning);
  }

  return {
    displayedDate,
    publishedAt: parsedDate.publishedAt,
    warnings,
  };
}

export function parseComment(element: Element): ParsedComment {
  const warnings: CommentWarning[] = [];
  const author = parseCommentAuthor(element);

  if (author.kind === 'unknown') {
    warnings.push('MISSING_AUTHOR');
  }

  const text = parseCommentText(element);
  if (text === null) {
    warnings.push('MISSING_TEXT');
  }

  const date = parseCommentDate(element);
  warnings.push(...date.warnings);

  const reactionCount = parseCommentReactionCount(element);
  if (reactionCount === null) {
    warnings.push('MISSING_REACTION_COUNT');
  }

  return {
    author,
    text,
    displayedDate: date.displayedDate,
    publishedAt: date.publishedAt,
    reactionCount,
    warnings,
  };
}
