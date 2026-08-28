import { readTrimmedText } from './parsing/domText';

const EXCLUDED_GROUP_PATHS = ['/groups/feed', '/groups/discover', '/groups/create'];

export type GroupPageInfo = {
  isGroupPage: boolean;
  groupName: string | null;
  groupUrl: string | null;
};

function isExcludedGroupPath(pathname: string): boolean {
  return EXCLUDED_GROUP_PATHS.some((path) => pathname.startsWith(path));
}

export function getGroupPageInfo(locationLike: Location = window.location): GroupPageInfo {
  const pathname = locationLike.pathname;
  const groupMatch = /^\/groups\/([^/?#]+)/.exec(pathname);

  if (groupMatch?.[1] === undefined || isExcludedGroupPath(pathname)) {
    return {
      isGroupPage: false,
      groupName: null,
      groupUrl: null,
    };
  }

  const groupSlug = groupMatch[1];
  const groupUrl = `${locationLike.origin}/groups/${groupSlug}`;

  const heading = document.querySelector('[role="heading"]');
  const trimmedGroupName = readTrimmedText(heading);
  const groupName = trimmedGroupName.length === 0 ? null : trimmedGroupName;

  return {
    isGroupPage: true,
    groupName,
    groupUrl,
  };
}

export function isGroupPage(locationLike: Location = window.location): boolean {
  return getGroupPageInfo(locationLike).isGroupPage;
}
