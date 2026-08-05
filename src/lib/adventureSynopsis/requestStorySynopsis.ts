import type { ProviderCode } from "@kaoruisaac/pedelec";
import { defineTool } from "@kaoruisaac/pedelec";
import { isNoiseHistoryNarrative } from "@/lib/historyHygiene";
import { pedelec } from "@/lib/pedelec/client";
import { useGameStore } from "@/store/useGameStore";

const submitSynopsisTool = defineTool({
  name: "submit_adventure_synopsis",
  description:
    "提交本場冒險的故事經歷總結（繁體中文）。只寫情節來龍去脈，勿寫技能成長、數值增減、物品清單。",
  argsSchema: {
    type: "object",
    properties: {
      synopsis: {
        type: "string",
        description:
          "150–400 字繁體中文：誰經歷了什麼、關鍵轉折與結局走向。不含成長／數值／戰利品條列。",
      },
    },
    required: ["synopsis"],
  },
});

const SYNOPSIS_GUIDANCE = `你是 TRPG 場記。根據提供的冒險紀錄，寫出「故事經歷總結」供角色履歷使用。

規則：
- 只輸出故事來龍去脈：角色為何捲入、途中經歷哪些關鍵事件／抉擇／危機、如何收束到結局。
- 使用繁體中文，連貫敘事一段或兩三段即可（約 150–400 字）。
- 不要寫技能成長、檢定數值、SAN／HP 增減、經驗值、物品獲得清單（那些另有欄位）。
- 不要劇透隱藏劇本的上帝視角真相；只根據實際遊玩過程與結局敘事。
- 必須呼叫 submit_adventure_synopsis 一次，把全文放進 synopsis。`;

function assembleStoryContext(): string {
  const store = useGameStore.getState();
  const title = store.script.public_summary?.title?.trim() || "未命名劇本";
  const characterName = store.character?.name?.trim() || "調查員";
  const ending = store.ending;

  const chapters = store.chapterSummaries
    .map((c) => `Turns ${c.fromTurn}–${c.toTurn}: ${c.summary}`)
    .join("\n");

  const history = store.history.filter(
    (h) => !isNoiseHistoryNarrative(h.aiNarrative),
  );
  // 取較後期與均勻抽樣，控制長度
  const picks: typeof history = [];
  if (history.length <= 14) {
    picks.push(...history);
  } else {
    const early = history.slice(0, 3);
    const midStart = Math.floor(history.length / 2) - 2;
    const mid = history.slice(Math.max(3, midStart), midStart + 4);
    const late = history.slice(-7);
    const seen = new Set<number>();
    for (const h of [...early, ...mid, ...late]) {
      if (seen.has(h.turn)) continue;
      seen.add(h.turn);
      picks.push(h);
    }
    picks.sort((a, b) => a.turn - b.turn);
  }

  const beats = picks
    .map((h) => {
      const player = h.playerInput?.trim()
        ? `玩家：${h.playerInput.trim().slice(0, 160)}`
        : null;
      const narr = h.aiNarrative.replace(/\s+/g, " ").trim().slice(0, 280);
      return [`[Turn ${h.turn}]`, player, narr ? `GM：${narr}` : null]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const clueTitles = store.clues
    .filter((c) => c.is_key_clue)
    .map((c) => c.title)
    .slice(0, 8);

  return [
    `劇本：《${title}》`,
    `主角：${characterName}${store.character?.role_title ? `（${store.character.role_title}）` : ""}`,
    ending
      ? `結局類型：${ending.ending_type}／標題：${ending.ending_title}`
      : null,
    ending?.ending_narrative
      ? `結局敘事（節錄）：\n${ending.ending_narrative.slice(0, 800)}`
      : null,
    clueTitles.length ? `過程中取得的關鍵線索名：${clueTitles.join("、")}` : null,
    chapters ? `[章節摘要]\n${chapters}` : null,
    `[回合節錄]\n${beats || "（無詳細回合）"}`,
    "請據此寫出故事經歷總結，並呼叫 submit_adventure_synopsis。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 短命 session：產生本場故事來龍去脈總結（不寫入 GM 聊天）。
 */
export async function requestStorySynopsis(options: {
  provider: ProviderCode;
  model?: string;
  signal?: AbortSignal;
}): Promise<string> {
  assertNotAborted(options.signal);

  const session = await pedelec.createSession({
    provider: options.provider,
    model: options.model || undefined,
    skills: {
      guidance: SYNOPSIS_GUIDANCE,
      tools: [submitSynopsisTool],
    },
    autoEndOnDisconnect: false,
  });

  let captured: string | null = null;
  let lastChat = "";

  const offChat = session.onChat((delta) => {
    lastChat += delta;
  });

  const offTool = session.onTool(
    "submit_adventure_synopsis",
    (args: { synopsis?: string }) => {
      const text = String(args?.synopsis ?? "").trim();
      if (text) captured = text;
      return { ok: true, received: Boolean(text) };
    },
  );

  const onAbort = () => {
    void safeEnd(session);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    assertNotAborted(options.signal);
    await session.sendText(assembleStoryContext());
    assertNotAborted(options.signal);

    const text = (captured ?? fallbackFromChat(lastChat)).trim();
    if (!text) throw new Error("STORY_SYNOPSIS_EMPTY");
    return text;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    offChat();
    offTool();
    await safeEnd(session);
  }
}

function fallbackFromChat(chat: string): string {
  const text = chat.trim();
  if (!text) return "";
  // 去掉可能的 tool JSON 殘段，取較長段落
  const cleaned = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\{[\s\S]*"synopsis"[\s\S]*\}/g, "")
    .trim();
  return cleaned.slice(0, 1200);
}

async function safeEnd(session: {
  end: () => Promise<void>;
}) {
  try {
    await session.end();
  } catch {
    // ignore
  }
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const err = new Error("STORY_SYNOPSIS_ABORTED");
    err.name = "AbortError";
    throw err;
  }
}
