import type { PedelecSession, ProviderCode } from "@kaoruisaac/pedelec";
import { assemblePlayerAgentPrompt } from "@/lib/aiPlayer/context";
import { PLAYER_AGENT_DIRECTIVES } from "@/lib/aiPlayer/directives";
import {
  playerAgentTools,
  type SubmitPlayerActionArgs,
} from "@/lib/aiPlayer/tools";
import { pedelec } from "@/lib/pedelec/client";
import { useGameStore } from "@/store/useGameStore";

type PlayerAgentSession = PedelecSession<(typeof playerAgentTools)[number]["name"]>;

/**
 * 每次請求開一個短命 Player Agent session，送完就結束。
 * 與 GM session 完全分離，不寫入聊天 UI、不改 game store。
 */
export async function requestAiPlayerAction(options: {
  provider: ProviderCode;
  model?: string;
  signal?: AbortSignal;
}): Promise<string> {
  assertNotAborted(options.signal);

  const store = useGameStore.getState();
  const prompt = assemblePlayerAgentPrompt({
    script: store.script,
    houseRules: store.houseRules,
    character: store.character,
    clues: store.clues,
    playerNotes: store.playerNotes,
    npcs: store.npcs,
    madness: store.madness,
    location: store.location,
    chapterSummaries: store.chapterSummaries,
    recentMessages: store.messages,
    turn: store.turn,
  });

  const session = await pedelec.createSession({
    provider: options.provider,
    model: options.model || undefined,
    skills: {
      guidance: PLAYER_AGENT_DIRECTIVES,
      tools: playerAgentTools,
    },
    autoEndOnDisconnect: false,
  });

  let captured: string | null = null;
  let lastChat = "";

  const offChat = session.onChat((delta) => {
    lastChat += delta;
  });

  const offTool = session.onTool(
    "submit_player_action",
    (args: SubmitPlayerActionArgs) => {
      const action = String(args?.action ?? "").trim();
      if (action) captured = action;
      return { ok: true, received: Boolean(action) };
    },
  );

  const onAbort = () => {
    void safeEnd(session);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    assertNotAborted(options.signal);
    await session.sendText(prompt);
    assertNotAborted(options.signal);

    const action = (captured ?? extractFallbackAction(lastChat)).trim();
    if (!action) {
      throw new Error("AI_PLAYER_NO_ACTION");
    }
    return action;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    offChat();
    offTool();
    await safeEnd(session);
  }
}

function extractFallbackAction(chat: string): string {
  const text = chat.trim();
  if (!text) return "";
  // 若模型只回文字未呼叫 tool，取最後非空段落當行動
  const parts = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

async function safeEnd(session: PlayerAgentSession) {
  try {
    await session.end();
  } catch {
    // ignore
  }
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const err = new Error("AI_PLAYER_ABORTED");
    err.name = "AbortError";
    throw err;
  }
}
