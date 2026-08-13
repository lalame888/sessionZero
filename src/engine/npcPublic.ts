import type { ChatMessage, NPCItem } from "@/types/game";

/** 玩家可見欄位不該出現的隱藏真相／感染標記 */
const SPOILER_RE =
  /感染末期|感染中|已被感染|正在感染|呼召石|深淵之咽|獻祭中|無意識獻祭|神話宿主|已被控制/g;

function stripSpoilers(text: string): string {
  return text
    .replace(SPOILER_RE, "")
    .replace(/[，、]{2,}/g, "，")
    .replace(/^[，、／/]+|[，、／/]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 對話／敘事是否已點到此 NPC（全名、名字、或四字名的姓氏如「木村」） */
export function npcNameMentionedInText(name: string, text: string): boolean {
  const n = name.replace(/[（(].*$/, "").trim();
  if (n.length < 2 || !text) return false;
  if (text.includes(n)) return true;
  if (n.length >= 3) {
    const given = n.slice(-2);
    if (given.length >= 2 && text.includes(given)) return true;
  }
  // 四字以上（如木村健太）：允許姓氏兩字出現在「木村先生」
  if (n.length >= 4) {
    const family = n.slice(0, 2);
    if (text.includes(family)) return true;
  }
  return false;
}

export function npcMentionedInMessages(
  name: string,
  messages: ChatMessage[],
  extraText = "",
): boolean {
  if (extraText && npcNameMentionedInText(name, extraText)) return true;
  return messages.some((m) => {
    if (m.role === "system") return false;
    return npcNameMentionedInText(name, m.content ?? "");
  });
}

export function sanitizeNpcPublicFields(npc: NPCItem): NPCItem {
  const relation = stripSpoilers(String(npc.relation ?? ""));
  const description = stripSpoilers(npc.description ?? "");
  const statusRaw = String(npc.status ?? "ALIVE").trim().toUpperCase();
  let status: NPCItem["status"] = "ALIVE";
  if (statusRaw === "DEAD" || /死亡|身亡/.test(String(npc.status))) {
    status = "DEAD";
  } else if (statusRaw === "MISSING" || /失蹤/.test(String(npc.status))) {
    status = "MISSING";
  } else if (statusRaw === "INSANE" || /瘋狂|瘋了/.test(String(npc.status))) {
    status = "INSANE";
  } else if (statusRaw === "ALIVE" || statusRaw === "ALIVE".toLowerCase()) {
    status = "ALIVE";
  }
  return {
    ...npc,
    relation: (relation || "NEUTRAL") as NPCItem["relation"],
    status,
    description,
  };
}

export function toStoredNpc(
  npc: NPCItem,
  messages: ChatMessage[],
  extraText = "",
): NPCItem {
  const publicNpc = sanitizeNpcPublicFields(npc);
  const known =
    npc.knownToPlayer === true ||
    npcMentionedInMessages(publicNpc.name, messages, extraText);
  return { ...publicNpc, knownToPlayer: known };
}

export function visibleNpcsForPlayer(npcs: NPCItem[]): NPCItem[] {
  return npcs.filter((n) => n.knownToPlayer);
}
