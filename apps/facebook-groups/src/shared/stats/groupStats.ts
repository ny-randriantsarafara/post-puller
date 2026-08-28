import type { CapturedPost, GroupInfo } from '../types';

export type PublicationWindow = {
  earliest: string | null;
  latest: string | null;
};

export type GroupCaptureStats = {
  group: GroupInfo;
  postCount: number;
  incompletePostCount: number;
  commentCount: number;
  publicationWindow: PublicationWindow;
  lastCapturedAt: string;
};

export type GroupStatsTotals = {
  postCount: number;
  incompletePostCount: number;
  commentCount: number;
};

export function groupPostsByGroupUrl(posts: CapturedPost[]): Map<string, CapturedPost[]> {
  const postsByGroupUrl = new Map<string, CapturedPost[]>();

  for (const post of posts) {
    const existingPosts = postsByGroupUrl.get(post.group.url) ?? [];
    postsByGroupUrl.set(post.group.url, [...existingPosts, post]);
  }

  return postsByGroupUrl;
}

export function buildPublicationWindow(posts: CapturedPost[]): PublicationWindow {
  const publishedDates = posts
    .map((post) => post.publishedAt)
    .filter((publishedAt): publishedAt is string => publishedAt !== null)
    .sort((left, right) => left.localeCompare(right));

  if (publishedDates.length === 0) {
    return {
      earliest: null,
      latest: null,
    };
  }

  return {
    earliest: publishedDates[0] ?? null,
    latest: publishedDates[publishedDates.length - 1] ?? null,
  };
}

function resolveGroupInfo(groupUrl: string, groupPosts: CapturedPost[]): GroupInfo {
  const firstPost = groupPosts[0];
  if (firstPost === undefined) {
    return { name: null, url: groupUrl };
  }

  return firstPost.group;
}

function buildGroupCaptureStats(
  groupUrl: string,
  groupPosts: CapturedPost[],
): GroupCaptureStats {
  const commentCount = groupPosts.reduce(
    (total, post) => total + post.comments.length,
    0,
  );
  const incompletePostCount = groupPosts.filter((post) => post.warnings.length > 0).length;
  const lastCapturedAt = groupPosts.reduce((latest, post) => {
    if (post.capturedAt > latest) {
      return post.capturedAt;
    }

    return latest;
  }, groupPosts[0]?.capturedAt ?? '');

  return {
    group: resolveGroupInfo(groupUrl, groupPosts),
    postCount: groupPosts.length,
    incompletePostCount,
    commentCount,
    publicationWindow: buildPublicationWindow(groupPosts),
    lastCapturedAt,
  };
}

export function buildGroupStats(posts: CapturedPost[]): GroupCaptureStats[] {
  const postsByGroupUrl = groupPostsByGroupUrl(posts);

  return [...postsByGroupUrl.entries()]
    .map(([groupUrl, groupPosts]) => buildGroupCaptureStats(groupUrl, groupPosts))
    .sort((left, right) => right.lastCapturedAt.localeCompare(left.lastCapturedAt));
}

export function sumGroupStats(groupStats: GroupCaptureStats[]): GroupStatsTotals {
  return groupStats.reduce(
    (totals, groupStat) => ({
      postCount: totals.postCount + groupStat.postCount,
      incompletePostCount: totals.incompletePostCount + groupStat.incompletePostCount,
      commentCount: totals.commentCount + groupStat.commentCount,
    }),
    {
      postCount: 0,
      incompletePostCount: 0,
      commentCount: 0,
    },
  );
}

export function findGroupStats(
  groupStats: GroupCaptureStats[],
  groupUrl: string | null,
): GroupCaptureStats | null {
  if (groupUrl === null) {
    return null;
  }

  return groupStats.find((groupStat) => groupStat.group.url === groupUrl) ?? null;
}

export function formatPublicationWindow(publicationWindow: PublicationWindow): string {
  if (publicationWindow.earliest === null || publicationWindow.latest === null) {
    return 'No parsed dates';
  }

  const earliestDay = publicationWindow.earliest.slice(0, 10);
  const latestDay = publicationWindow.latest.slice(0, 10);

  if (earliestDay === latestDay) {
    return earliestDay;
  }

  return `${earliestDay} to ${latestDay}`;
}
