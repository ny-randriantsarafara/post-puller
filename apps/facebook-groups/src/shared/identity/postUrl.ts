export function normalizePostUrl(rawUrl: string | null): string | null {
  if (rawUrl === null || rawUrl.trim().length === 0) {
    return null;
  }

  try {
    const url = new URL(rawUrl, 'https://www.facebook.com');
    url.search = '';
    url.hash = '';

    let pathname = url.pathname.replace(/\/+$/, '');
    if (pathname.length === 0) {
      pathname = '/';
    }

    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

export function buildGroupPostUrl(groupUrl: string, postId: string): string {
  const normalizedGroupUrl = groupUrl.replace(/\/+$/, '');
  return `${normalizedGroupUrl}/posts/${postId}/`;
}

export function extractPostIdFromPhotoLink(rawUrl: string | null): string | null {
  if (rawUrl === null || rawUrl.trim().length === 0) {
    return null;
  }

  try {
    const url = new URL(rawUrl, 'https://www.facebook.com');
    const setParam = url.searchParams.get('set');
    if (setParam === null) {
      return null;
    }

    const groupMatch = /^gm\.(\d+)/.exec(setParam);
    if (groupMatch?.[1] !== undefined) {
      return groupMatch[1];
    }

    const photoMatch = /^pcb\.(\d+)/.exec(setParam);
    if (photoMatch?.[1] !== undefined) {
      return photoMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}

export function extractPostIdFromUrl(rawUrl: string | null): string | null {
  const normalizedUrl = normalizePostUrl(rawUrl);
  if (normalizedUrl === null) {
    return null;
  }

  const permalinkMatch = /\/groups\/[^/]+\/permalink\/(\d+)/.exec(normalizedUrl);
  if (permalinkMatch?.[1] !== undefined) {
    return permalinkMatch[1];
  }

  const postsMatch = /\/groups\/[^/]+\/posts\/(\d+)/.exec(normalizedUrl);
  if (postsMatch?.[1] !== undefined) {
    return postsMatch[1];
  }

  const storyMatch = /\/story\.php\?story_fbid=(\d+)/.exec(normalizedUrl);
  if (storyMatch?.[1] !== undefined) {
    return storyMatch[1];
  }

  return null;
}

export function extractPostIdFromElement(element: Element): string | null {
  const dataFt = element.getAttribute('data-ft');
  if (dataFt !== null) {
    const topLevelMatch = /"top_level_post_id":"(\d+)"/.exec(dataFt);
    if (topLevelMatch?.[1] !== undefined) {
      return topLevelMatch[1];
    }
  }

  const idAttribute = element.getAttribute('id');
  if (idAttribute !== null) {
    const idMatch = /(?:^|_)post(?:_|-)?(\d+)/i.exec(idAttribute);
    if (idMatch?.[1] !== undefined) {
      return idMatch[1];
    }
  }

  const links = element.querySelectorAll('a[href]');
  for (const link of links) {
    const href = link.getAttribute('href');
    if (href === null) {
      continue;
    }

    const photoPostId = extractPostIdFromPhotoLink(href);
    if (photoPostId !== null) {
      return photoPostId;
    }

    const fullUrl = new URL(href, 'https://www.facebook.com').toString();
    if (href.includes('comment_id=')) {
      continue;
    }

    const postId = extractPostIdFromUrl(fullUrl);
    if (postId !== null) {
      return postId;
    }
  }

  for (const link of links) {
    const href = link.getAttribute('href');
    if (href === null) {
      continue;
    }

    const fullUrl = new URL(href, 'https://www.facebook.com').toString();
    const postId = extractPostIdFromUrl(fullUrl);
    if (postId !== null) {
      return postId;
    }
  }

  return null;
}
