import { readTrimmedText } from './parsing/domText';

const EXCLUDED_GROUP_PATHS = ['/groups/feed', '/groups/discover', '/groups/create'];

// What the generic capture layer needs to know about the current page: whether
// it can capture here, and what collection anything captured belongs to.
export type PageTarget = {
  isTargetPage: boolean;
  collectionName: string | null;
  collectionUrl: string | null;
};

function isExcludedGroupPath(pathname: string): boolean {
  return EXCLUDED_GROUP_PATHS.some((path) => pathname.startsWith(path));
}

export function resolvePageTarget(locationLike: Location = window.location): PageTarget {
  const pathname = locationLike.pathname;
  const groupMatch = /^\/groups\/([^/?#]+)/.exec(pathname);

  if (groupMatch?.[1] === undefined || isExcludedGroupPath(pathname)) {
    return {
      isTargetPage: false,
      collectionName: null,
      collectionUrl: null,
    };
  }

  const groupSlug = groupMatch[1];
  const collectionUrl = `${locationLike.origin}/groups/${groupSlug}`;

  const heading = document.querySelector('[role="heading"]');
  const trimmedGroupName = readTrimmedText(heading);
  const collectionName = trimmedGroupName.length === 0 ? null : trimmedGroupName;

  return {
    isTargetPage: true,
    collectionName,
    collectionUrl,
  };
}

export function isGroupPage(locationLike: Location = window.location): boolean {
  return resolvePageTarget(locationLike).isTargetPage;
}
