import type { PartyMember } from "@/types/party";

/** 玩家行動是否點名 AI 隊友（依角色姓名） */
export function aiCompanionsMentionedInAction(
  playerAction: string,
  party: PartyMember[],
  playerMemberId?: string | null,
): PartyMember[] {
  const action = playerAction.trim();
  if (!action) return [];
  return party.filter((m) => {
    if (m.controller !== "ai") return false;
    if (playerMemberId && m.id === playerMemberId) return false;
    const name = m.sheet.name?.trim();
    return Boolean(name && action.includes(name));
  });
}

export function buildCompanionMentionDirective(
  playerAction: string,
  party: PartyMember[],
  playerMemberId?: string | null,
): string {
  const mentioned = aiCompanionsMentionedInAction(
    playerAction,
    party,
    playerMemberId,
  );
  if (!mentioned.length) return "";
  const names = mentioned
    .map(
      (m) =>
        `${m.sheet.name}（id=${m.id}，${m.sheet.role_title || m.roleHint || "隊友"}）`,
    )
    .join("、");
  return `[COMPANION TRIGGER — MANDATORY]
Player action references AI companion(s): ${names}.
You MUST call request_companion_action for at least one who can plausibly respond this beat (same GM turn cycle, before you finish).
Do NOT narrate their speech or decisive actions yourself — the companion agent speaks via the tool; you only resolve outcomes after their declaration.
If none would act, still call the tool once for the most relevant id and let them pass silently.`;
}
