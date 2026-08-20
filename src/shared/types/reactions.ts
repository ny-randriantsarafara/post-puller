export const REACTION_TYPES = [
  'like',
  'love',
  'care',
  'haha',
  'wow',
  'sad',
  'angry',
] as const;

export type ReactionType = (typeof REACTION_TYPES)[number];

export type ReactionBreakdown = Partial<Record<ReactionType, number>>;

export function sumReactionBreakdown(breakdown: ReactionBreakdown): number {
  return REACTION_TYPES.reduce((total, reactionType) => {
    return total + (breakdown[reactionType] ?? 0);
  }, 0);
}

export function isPartialReactionBreakdown(
  breakdown: ReactionBreakdown,
  totalCount: number | null,
): boolean {
  if (totalCount === null) {
    return false;
  }

  const visibleTotal = sumReactionBreakdown(breakdown);
  if (visibleTotal === 0) {
    return false;
  }

  return visibleTotal < totalCount;
}
