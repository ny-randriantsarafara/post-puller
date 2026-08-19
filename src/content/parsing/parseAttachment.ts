import type { Attachment } from '../../shared/types';
import { SELECTORS } from './selectors';

function normalizeOutboundUrl(href: string): string {
  const absoluteUrl = new URL(href, 'https://www.facebook.com');
  if (absoluteUrl.hostname === 'l.facebook.com') {
    return absoluteUrl.searchParams.get('u') ?? absoluteUrl.toString();
  }

  return absoluteUrl.toString();
}

function findLinkAttachment(root: Element): Attachment | null {
  const links = [...root.querySelectorAll(SELECTORS.link)];

  for (const link of links) {
    const href = link.getAttribute('href');
    if (href === null || href.includes('/groups/')) {
      continue;
    }

    return {
      kind: 'link',
      url: normalizeOutboundUrl(href),
    };
  }

  return null;
}

export function parseAttachment(root: Element): Attachment {
  const thumbnail = root.querySelector(
    `[data-ad-rendering-role="thumbnail"] ${SELECTORS.image}`,
  );
  if (thumbnail !== null) {
    return {
      kind: 'image',
      url: thumbnail.getAttribute('src'),
    };
  }

  const video = root.querySelector(SELECTORS.video);
  if (video !== null) {
    const src = video.getAttribute('src');
    return {
      kind: 'video',
      url: src,
    };
  }

  const image = [...root.querySelectorAll(SELECTORS.image)].find((candidate) => {
    const width = Number(candidate.getAttribute('width') ?? '0');
    const height = Number(candidate.getAttribute('height') ?? '0');
    const hasNoDeclaredDimensions = width === 0 && height === 0;
    return hasNoDeclaredDimensions || width > 32 || height > 32;
  });
  if (image !== undefined) {
    const src = image.getAttribute('src');
    return {
      kind: 'image',
      url: src,
    };
  }

  const linkAttachment = findLinkAttachment(root);
  if (linkAttachment !== null) {
    return linkAttachment;
  }

  const sharedPost = root.querySelector(`${SELECTORS.article} ${SELECTORS.article}`);
  if (sharedPost !== null) {
    return {
      kind: 'sharedPost',
      url: null,
    };
  }

  return { kind: 'none' };
}
