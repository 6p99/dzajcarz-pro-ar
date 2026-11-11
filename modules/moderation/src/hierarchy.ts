/** What the moderation rules need to know about a member of the guild. */
export interface MemberInfo {
  id: string;
  isOwner: boolean;
  /** Position of the member's highest role; 0 is @everyone. */
  topRole: number;
  /** Guild-level permission bits (roles only, no channel overwrites). */
  permissions: bigint;
  /** Whether a timeout is running for the member right now. */
  timedOut: boolean;
}

export const SELF_TARGET = "لا يمكنك الإشراف على نفسك.";
export const BOT_TARGET = "لا يمكنني الإشراف على نفسي.";
export const OWNER_TARGET = "لا يمكن الإشراف على مالك الخادم.";
export const HIGHER_THAN_ACTOR = "رتبة هذا الشخص مساوية لرتبتك أو أعلى منها.";
export const HIGHER_THAN_BOT = "رتبتي منخفضة جدًا للإشراف على هذا الشخص.";

/**
 * Discord's own rule for moderating someone, checked before the bot asks Discord, so the caller gets a
 * clear reason instead of a "missing permissions" error. `target` is null for a user who is not a member
 * (only a ban can reach them): they hold no roles, so only the id rules apply. Returns the Polish refusal,
 * or null when the action may go ahead.
 */
export function checkHierarchy({
  actor,
  bot,
  targetId,
  target,
}: {
  actor: MemberInfo;
  bot: MemberInfo;
  targetId: string;
  target: MemberInfo | null;
}): string | null {
  if (targetId === actor.id) return SELF_TARGET;
  if (targetId === bot.id) return BOT_TARGET;
  if (!target) return null;
  if (target.isOwner) return OWNER_TARGET;
  if (!actor.isOwner && target.topRole >= actor.topRole) return HIGHER_THAN_ACTOR;
  if (target.topRole >= bot.topRole) return HIGHER_THAN_BOT;
  return null;
}
