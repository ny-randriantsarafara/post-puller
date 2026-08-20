import type { ReactionBreakdown } from '../../shared/types/reactions';
import { sumReactionBreakdown } from '../../shared/types/reactions';
import { readTrimmedText } from './domText';
import { parseCountFromText, parseReactionCountFromElement } from './parseCount';
import {
  REACTION_TYPE_ARIA_PATTERNS,
} from './selectors';

export type ParsedEngagement = {
  reactionCount: number | null;
  reactionBreakdown: ReactionBreakdown;
  commentCount: number | null;
  shareCount: number | null;
};

function parseReactionTypeFromLabel(label: string): {
  reactionType: keyof ReactionBreakdown;
  count: number;
} | null {
  for (const { reactionType, pattern } of REACTION_TYPE_ARIA_PATTERNS) {
    const match = pattern.exec(label);
    if (match?.[1] === undefined) {
      continue;
    }

    const count = parseCountFromText(match[1]);
    if (count === null) {
      continue;
    }

    return { reactionType, count };
  }

  return null;
}

function isReactionToolbar(element: Element): boolean {
  const label = element.getAttribute('aria-label') ?? '';
  return /see who reacted|voir qui a réagi/i.test(label);
}

export function parseReactionBreakdown(searchRoot: Element): ReactionBreakdown {
  const breakdown: ReactionBreakdown = {};

  for (const toolbar of searchRoot.querySelectorAll('[role="toolbar"]')) {
    if (!isReactionToolbar(toolbar)) {
      continue;
    }

    for (const candidate of toolbar.querySelectorAll('[aria-label]')) {
      const label = candidate.getAttribute('aria-label') ?? '';
      const parsedReaction = parseReactionTypeFromLabel(label);
      if (parsedReaction === null) {
        continue;
      }

      breakdown[parsedReaction.reactionType] = parsedReaction.count;
    }
  }

  return breakdown;
}

function readFooterCounter(
  searchRoot: Element,
  renderingRole: 'like_button' | 'comment_button' | 'share_button',
): number | null {
  const marker = searchRoot.querySelector(
    `[data-ad-rendering-role="${renderingRole}"]`,
  );
  if (marker === null) {
    return null;
  }

  const button = marker.closest('[role="button"]');
  if (button === null) {
    return null;
  }

  const counterElement = button.querySelector('[dir="auto"]');
  return parseCountFromText(readTrimmedText(counterElement));
}

function parseAggregateReactionCount(searchRoot: Element): number | null {
  for (const candidate of searchRoot.querySelectorAll('[aria-label]')) {
    const label = candidate.getAttribute('aria-label') ?? '';
    if (/^like:\s*\d/i.test(label)) {
      continue;
    }

    if (!/reactions?|réactions?/i.test(label)) {
      continue;
    }

    const reactionCount = parseReactionCountFromElement(candidate);
    if (reactionCount !== null) {
      return reactionCount;
    }
  }

  for (const candidate of searchRoot.querySelectorAll('[aria-label]')) {
    const reactionCount = parseReactionCountFromElement(candidate);
    if (reactionCount !== null) {
      return reactionCount;
    }
  }

  return null;
}

export function parseEngagement(searchRoot: Element): ParsedEngagement {
  const reactionBreakdown = parseReactionBreakdown(searchRoot);
  const reactionCountFromFooter = readFooterCounter(searchRoot, 'like_button');
  const commentCount = readFooterCounter(searchRoot, 'comment_button');
  const shareCount = readFooterCounter(searchRoot, 'share_button');

  let reactionCount = reactionCountFromFooter;
  if (reactionCount === null) {
    reactionCount = parseAggregateReactionCount(searchRoot);
  }

  if (reactionCount === null) {
    const breakdownTotal = sumReactionBreakdown(reactionBreakdown);
    reactionCount = breakdownTotal > 0 ? breakdownTotal : null;
  }

  return {
    reactionCount,
    reactionBreakdown,
    commentCount,
    shareCount,
  };
}

export function parseCommentEngagement(commentElement: Element): {
  reactionCount: number | null;
  reactionBreakdown: ReactionBreakdown;
} {
  const reactionBreakdown = parseReactionBreakdown(commentElement);
  let reactionCount: number | null = null;

  for (const candidate of commentElement.querySelectorAll('[aria-label]')) {
    const label = candidate.getAttribute('aria-label') ?? '';
    if (/^like:\s*\d/i.test(label)) {
      continue;
    }

    if (!/reactions?|réactions?/i.test(label)) {
      continue;
    }

    const parsedCount = parseReactionCountFromElement(candidate);
    if (parsedCount !== null) {
      reactionCount = parsedCount;
      break;
    }
  }

  if (reactionCount === null) {
    const breakdownTotal = sumReactionBreakdown(reactionBreakdown);
    reactionCount = breakdownTotal > 0 ? breakdownTotal : null;
  }

  return {
    reactionCount,
    reactionBreakdown,
  };
}
