import type { ChatMessage } from "@/types/game";
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

export function recentCompanionSpeakerNames(
  messages: ChatMessage[] | undefined | null,
  lookback = 16,
): string[] {
  if (!messages?.length) return [];
  const names: string[] = [];
  for (const m of messages.slice(-lookback)) {
    if (m.role !== "user") continue;
    const hit = m.content.trim().match(/^【隊友[·・]([^】]+)】/);
    if (hit?.[1]?.trim()) names.push(hit[1].trim());
  }
  return names;
}

function isMedicCompanion(m: PartyMember): boolean {
  const hay = `${m.sheet.role_title ?? ""} ${m.roleHint ?? ""} ${m.sheet.profile_coc?.occupation ?? ""} ${m.sheet.name ?? ""}`;
  return /醫|急救|解剖|護士|軍醫|醫師|藥劑/.test(hay);
}

/** 隊友宣告是否需要引擎／GM 檢定（開槍、刺擊、燒灼、開鎖、急救） */
export function companionActionNeedsCheck(
  action: string,
): { skillHint: string } | null {
  const t = action.trim();
  if (!t) return null;
  if (/開鎖|撬鎖|鎖匠|鐵絲.{0,6}鎖/.test(t)) return { skillHint: "鎖匠" };
  if (/急救|包紮|切開.{0,8}繭|清創|止血/.test(t)) return { skillHint: "急救" };
  if (
    /(?:開)?槍|開火|射擊|左輪|手槍/.test(t) &&
    /射|開|瞄|對準|舉槍/.test(t)
  ) {
    return { skillHint: "射擊" };
  }
  if (/燒灼|燒焦|燈焰.{0,8}(燒|灼|烤|融)|煤油燈.{0,16}(燒|灼|烤|融)/.test(t)) {
    return { skillHint: "幸運" };
  }
  if (/猛刺|刺向|刺進|砍向|劈向|毆|揮刀|手術刀.{0,12}(刺|砍)/.test(t)) {
    return { skillHint: "鬥毆" };
  }
  return null;
}

export function buildCompanionMentionDirective(
  playerAction: string,
  party: PartyMember[],
  playerMemberId?: string | null,
  opts?: {
    messages?: ChatMessage[];
    pcHpCurrent?: number | null;
    pcHpMax?: number | null;
  },
): string {
  const mentioned = aiCompanionsMentionedInAction(
    playerAction,
    party,
    playerMemberId,
  );
  const ais = party.filter(
    (m) => m.controller === "ai" && m.id !== playerMemberId,
  );
  const parts: string[] = [];

  if (mentioned.length) {
    const names = mentioned
      .map(
        (m) =>
          `${m.sheet.name}（id=${m.id}，${m.sheet.role_title || m.roleHint || "隊友"}）`,
      )
      .join("、");
    parts.push(`[COMPANION TRIGGER — MANDATORY]
Player action references AI companion(s): ${names}.
You MUST call request_companion_action for at least one who can plausibly respond this beat (same GM turn cycle, before you finish).
Do NOT narrate their speech or decisive actions yourself — the companion agent speaks via the tool; you only resolve outcomes after their declaration.
If none would act, still call the tool once for the most relevant id and let them pass silently.${
      mentioned.length >= 2
        ? `\nBoth named companions should be invited this beat (one may pass silently). Do not only wake the same person.`
        : ""
    }`);
  }

  const medical = ais.find(isMedicCompanion);
  const hpHurt =
    opts?.pcHpCurrent != null &&
    opts?.pcHpMax != null &&
    opts.pcHpMax > 0 &&
    opts.pcHpCurrent < opts.pcHpMax;
  const injuryContext = /傷|血|孢子|急救|包紮|灼|中毒|昏迷|重傷/.test(
    playerAction,
  );
  if (
    medical &&
    (hpHurt || injuryContext) &&
    !mentioned.some((m) => m.id === medical.id)
  ) {
    parts.push(`[MEDICAL HOOK]
${medical.sheet.name}（id=${medical.id}）is a medic. Injury/HP/spores are in play. Also call request_companion_action for them unless they cannot plausibly act. Do not narrate their treatment yourself.`);
  }

  const recent = recentCompanionSpeakerNames(opts?.messages);
  const last = recent[recent.length - 1];
  const prev = recent[recent.length - 2];
  if (
    !mentioned.length &&
    last &&
    prev &&
    last === prev &&
    ais.length > 1
  ) {
    const other =
      ais.find((m) => m.sheet.name?.trim() !== last) ?? ais[0];
    if (other) {
      parts.push(`[COMPANION ROTATION]
${last} acted the last two companion beats. Prefer requesting a different companion (e.g. ${other.sheet.name} id=${other.id}) if they can help, or let them pass. Do not only spotlight the same PC.`);
    }
  }

  return parts.join("\n\n");
}
