/** 從 history.playerInput 解析發言者（玩家 PC vs AI 隊友） */

const COMPANION_INPUT_RE = /^【隊友[·・]([^】]+)】(.*)$/s;

export type HistoryActorKind = "player" | "companion";

export interface ParsedHistoryActorInput {
  kind: HistoryActorKind;
  /** 顯示用標籤：玩家 / 隊友 · 林曉涵 */
  label: string;
  /** 去掉【隊友·名】前綴後的正文 */
  body: string;
  companionName?: string;
}

export function parseHistoryActorInput(
  playerInput: string,
): ParsedHistoryActorInput {
  const raw = playerInput.trim();
  const m = raw.match(COMPANION_INPUT_RE);
  if (m) {
    const companionName = (m[1] ?? "").trim() || "隊友";
    const body = (m[2] ?? "").trimStart();
    return {
      kind: "companion",
      label: `隊友 · ${companionName}`,
      body: body || raw,
      companionName,
    };
  }
  return {
    kind: "player",
    label: "玩家",
    body: raw,
  };
}
