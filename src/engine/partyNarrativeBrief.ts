import type { UniversalCharacterSheet } from "@/types/game";
import type { PartyMember, PartyRoleHint } from "@/types/party";

function sheetBrief(sheet: UniversalCharacterSheet): string {
  const bits: string[] = [];
  if (sheet.name?.trim()) bits.push(`姓名「${sheet.name.trim()}」`);
  if (sheet.role_title?.trim()) bits.push(`職稱「${sheet.role_title.trim()}」`);
  if (sheet.profile_coc?.occupation?.trim()) {
    bits.push(`職業「${sheet.profile_coc.occupation.trim()}」`);
  }
  if (sheet.profile_dnd?.class_name?.trim()) {
    bits.push(`職業「${sheet.profile_dnd.class_name.trim()}」`);
  }
  if (sheet.profile_dnd?.race?.trim()) {
    bits.push(`種族「${sheet.profile_dnd.race.trim()}」`);
  }
  if (sheet.profile_dnd?.background?.trim()) {
    bits.push(`背景「${sheet.profile_dnd.background.trim()}」`);
  }
  if (sheet.age?.trim()) bits.push(`年齡 ${sheet.age.trim()}`);
  if (sheet.gender?.trim()) bits.push(`性別 ${sheet.gender.trim()}`);
  if (sheet.appearance?.trim()) {
    const a = sheet.appearance.trim();
    bits.push(`外貌：${a.length > 80 ? `${a.slice(0, 80)}…` : a}`);
  }
  if (sheet.personal_bio?.trim()) {
    const b = sheet.personal_bio.trim();
    bits.push(`背景短述：${b.length > 120 ? `${b.slice(0, 120)}…` : b}`);
  }
  return bits.join("；") || "（僅有空白卡）";
}

function topSkillsLine(sheet: UniversalCharacterSheet, n = 4): string {
  const top = Object.entries(sheet.skills)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, v]) => `${name}${v}%`);
  return top.length ? top.join("、") : "（無）";
}

function isSlotConfigured(m: PartyMember | undefined): boolean {
  if (!m) return false;
  if (m.creationComplete) return true;
  return Boolean(m.sheet.name?.trim() && m.sheet.role_title?.trim());
}

/**
 * 創角「請 AI 設計角色敘事」用：摘要已就緒隊友與空席建議，供避免重複／平衡隊伍。
 */
export function buildPartyNarrativeDesignContext(input: {
  party: PartyMember[];
  partySize: number;
  editingSlotIndex: number;
  roleHints?: PartyRoleHint[] | null;
  protagonistRole?: string | null;
}): string {
  const {
    party,
    partySize,
    editingSlotIndex,
    roleHints,
    protagonistRole,
  } = input;
  if (partySize <= 1) return "";

  const lines: string[] = [
    "【隊伍現況——請參考後設計本席角色】",
    `隊伍人數：${partySize}；本席為席次 ${editingSlotIndex + 1}（請只設計本席，勿改寫其他席）。`,
  ];

  const configured = party.filter(
    (m) => m.slotIndex !== editingSlotIndex && isSlotConfigured(m),
  );
  if (configured.length) {
    lines.push(
      "已設定完成的隊友（請避免姓名／職能／背景高度重複，並與之互補）：",
    );
    for (const m of configured.sort((a, b) => a.slotIndex - b.slotIndex)) {
      const who = m.controller === "player" ? "玩家" : "AI";
      const hint = m.roleHint?.trim();
      lines.push(
        `- 席次 ${m.slotIndex + 1}［${who}］${hint ? `（定位：${hint}）` : ""}：${sheetBrief(m.sheet)}`,
      );
    }
  } else {
    lines.push("目前尚無其他已完成席次；本席可作為隊伍核心之一。");
  }

  const emptyHints: string[] = [];
  for (let i = 0; i < partySize; i++) {
    if (i === editingSlotIndex) continue;
    const m = party.find((p) => p.slotIndex === i);
    if (isSlotConfigured(m)) continue;
    const hint =
      m?.roleHint?.trim() ||
      roleHints?.[i]?.role_title?.trim() ||
      (i === 0 ? protagonistRole?.trim() : undefined);
    emptyHints.push(
      hint
        ? `席次 ${i + 1}（未完成，建議定位：${hint}）`
        : `席次 ${i + 1}（未完成）`,
    );
  }
  if (emptyHints.length) {
    lines.push(`其餘未完成席次：${emptyHints.join("；")}`);
  }

  const thisHint =
    party.find((m) => m.slotIndex === editingSlotIndex)?.roleHint?.trim() ||
    roleHints?.[editingSlotIndex]?.role_title?.trim() ||
    (editingSlotIndex === 0 ? protagonistRole?.trim() : undefined);
  const thisBrief = roleHints?.[editingSlotIndex]?.brief?.trim();
  if (thisHint) {
    lines.push(
      `本席建議定位：${thisHint}${thisBrief ? `——${thisBrief}` : ""}`,
    );
  }

  lines.push(
    "設計要求：盡量不要與已完成隊友在姓名、職業／職能、個性與背景上過度重複；能力與敘事定位應互補，使隊伍職能平衡（調查／社交／戰鬥／知識／後援等視劇本需要分配）。",
  );

  return lines.join("\n");
}

/** 遊玩／開場：給 GM 的隊伍名冊（含 AI 隊友 id，供 request_companion_action） */
export function formatPartyRosterForGm(
  party: PartyMember[],
  playerMemberId?: string | null,
): string {
  if (!party.length) return "";
  const sorted = [...party].sort((a, b) => a.slotIndex - b.slotIndex);
  const lines = sorted.map((m) => {
    const isPlayer =
      m.controller === "player" || m.id === playerMemberId;
    const tag = isPlayer ? "PLAYER" : "AI_COMPANION";
    const s = m.sheet;
    const look = s.appearance?.trim()
      ? s.appearance.trim().length > 60
        ? `${s.appearance.trim().slice(0, 60)}…`
        : s.appearance.trim()
      : "";
    const bits = [
      `${tag} 席次${m.slotIndex + 1}`,
      `id=${m.id}`,
      s.name?.trim() || "未命名",
      s.role_title?.trim() || m.roleHint?.trim() || "—",
      s.profile_coc?.occupation?.trim() ||
        s.profile_dnd?.class_name?.trim() ||
        "",
      `HP ${s.derived.hp.current}/${s.derived.hp.max}`,
      s.derived.san
        ? `SAN ${s.derived.san.current}/${s.derived.san.max}`
        : "",
      `專長：${topSkillsLine(s)}`,
      look ? `外貌：${look}` : "",
    ].filter(Boolean);
    return `- ${bits.join(" · ")}`;
  });
  const aiCount = sorted.filter(
    (m) => m.controller === "ai" && m.id !== playerMemberId,
  ).length;
  return [
    `[PARTY ROSTER — ${sorted.length} 人同行；其中 AI 隊友 ${aiCount} 名]`,
    "開場與場景敘事必須讓這些人在場可見（點名／同行／分工）；需要某 AI 隊友行動時呼叫 request_companion_action(companion_id=其 id)。玩家點名／指示隊友時必須喚起，勿自行代寫隊友言行。隊友是完整 PC：以其宣告為準，勿用第三人稱當 NPC 重述；結算檢定必須帶 character_id。",
    ...lines,
  ].join("\n");
}

/** 開場專用附加指令（有 AI 隊友時強制介紹） */
export function buildOpeningPartyDirective(
  party: PartyMember[],
  playerMemberId?: string | null,
): string {
  const companions = party.filter(
    (m) =>
      m.controller === "ai" &&
      m.id !== playerMemberId &&
      Boolean(m.sheet.name?.trim()),
  );
  if (companions.length === 0) return "";
  const names = companions
    .map(
      (m) =>
        `「${m.sheet.name}」（${m.sheet.role_title || m.roleHint || "隊友"}，id=${m.id}）`,
    )
    .join("、");
  return [
    `【隊伍開場・強制】本場共 ${party.length} 人：1 名玩家 PC + ${companions.length} 名 AI 隊友。`,
    `開場 narrate_story 必須點名介紹所有同行者（至少姓名與職稱／定位），描述他們與玩家一同在場；隊友可有靜態姿態（坐下、整理裝備），但不可替玩家 PC 決定行動／對話／意圖。`,
    `AI 隊友：${names}`,
    "之後場景預設他們仍同行；需要其專長／分頭行動時用 request_companion_action。",
  ].join("\n");
}
