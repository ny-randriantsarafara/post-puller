import { REACTION_ARIA_PATTERNS, COMMENT_REACTION_ARIA_PATTERNS } from './selectors';

function normalizeCount(rawValue: string): number | null {
  const cleaned = rawValue.replace(/[\s,]/g, '').replace(/\./g, '');
  const parsed = Number(cleaned);

  if (Number.isNaN(parsed)) {
    return null;
  }

  return parsed;
}

export function parseCountFromText(rawValue: string | null | undefined): number | null {
  if (rawValue === null || rawValue === undefined || rawValue.trim().length === 0) {
    return null;
  }

  const match = /(\d[\d,.\s]*)/.exec(rawValue);
  if (match?.[1] === undefined) {
    return null;
  }

  return normalizeCount(match[1]);
}

export function parseReactionCountFromElement(element: Element): number | null {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel !== null) {
    for (const pattern of REACTION_ARIA_PATTERNS) {
      const match = pattern.exec(ariaLabel);
      if (match?.[1] !== undefined) {
        return parseCountFromText(match[1]);
      }
    }
  }

  const textContent = element.textContent;
  return parseCountFromText(textContent);
}

export function parseCommentReactionCount(element: Element): number | null {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel !== null) {
    for (const pattern of COMMENT_REACTION_ARIA_PATTERNS) {
      const match = pattern.exec(ariaLabel);
      if (match?.[1] !== undefined) {
        return parseCountFromText(match[1]);
      }
    }
  }

  return parseCountFromText(element.textContent);
}
