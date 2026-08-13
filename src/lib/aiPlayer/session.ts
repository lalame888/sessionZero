import type { PedelecSession, ProviderCode } from "@kaoruisaac/pedelec";
import { assemblePlayerAgentPrompt } from "@/lib/aiPlayer/context";
import { PLAYER_AGENT_DIRECTIVES } from "@/lib/aiPlayer/directives";
import {
  playerAgentTools,
  type SubmitPlayerActionArgs,
} from "@/lib/aiPlayer/tools";
import { SIDE_SESSION_REUSE_EVERY } from "@/engine/gmMemoryPolicy";
import { explicitSessionModel, pedelec } from "@/lib/pedelec/client";
import { waitForPedelecCoreStatus } from "@/lib/pedelec/sessionLiveness";
import { useGameStore } from "@/store/useGameStore";
import { resolvePlayerBoundSheet } from "@/types/party";

type PlayerAgentSession = PedelecSession<(typeof playerAgentTools)[number]["name"]>;

type PlayerHandle = {
  session: PlayerAgentSession;
  disposeListeners: () => void;
  provider: ProviderCode;
  model?: string;
  sendCount: number;
};

let playerHandle: PlayerHandle | null = null;
let liveCaptured: string | null = null;
let liveChat = "";

function sessionReusable(
  handle: PlayerHandle,
  provider: ProviderCode,
  model?: string,
): boolean {
  if (handle.provider !== provider) return false;
  if ((handle.model || undefined) !== (model || undefined)) return false;
  if (handle.sendCount <= 0) return false;
  if (handle.sendCount % SIDE_SESSION_REUSE_EVERY === 0) return false;
  return handle.session.getStatus() === "idle";
}

async function ensurePlayerAgentSession(options: {
  provider: ProviderCode;
  model?: string;
}): Promise<PlayerHandle> {
  if (
    playerHandle &&
    sessionReusable(playerHandle, options.provider, options.model)
  ) {
    return playerHandle;
  }

  await disposeAiPlayerSession();

  const session = await pedelec.createSession({
    provider: options.provider,
    model: explicitSessionModel(options.model),
    skills: {
      guidance: PLAYER_AGENT_DIRECTIVES,
      tools: playerAgentTools,
    },
    autoEndOnDisconnect: true,
  });

  const offChat = session.onChat((delta) => {
    liveChat += delta;
  });

  const offTool = session.onTool(
    "submit_player_action",
    (args: SubmitPlayerActionArgs) => {
      const action = String(args?.action ?? "").trim();
      if (action) liveCaptured = action;
      return { ok: true, received: Boolean(action) };
    },
  );

  // createSession 後 subscribe 會 replay idle；若立刻 sendText，遲到的 idle
  // 會清掉 activeTurn，tool_call 進不了網頁。先等 core 狀態落地再送第一句。
  await waitForPedelecCoreStatus(session, {
    timeoutMs: 500,
    allowTimeout: true,
  });

  playerHandle = {
    session,
    disposeListeners: () => {
      offChat();
      offTool();
    },
    provider: options.provider,
    model: options.model || undefined,
    sendCount: 0,
  };
  return playerHandle;
}

/**
 * 續聊 Player Agent session。結束主 GM session 時請呼叫 disposeAiPlayerSession。
 */
export async function requestAiPlayerAction(options: {
  provider: ProviderCode;
  model?: string;
  signal?: AbortSignal;
}): Promise<string> {
  assertNotAborted(options.signal);

  const store = useGameStore.getState();
  const playerCharacter = resolvePlayerBoundSheet(store);
  const handle = await ensurePlayerAgentSession({
    provider: options.provider,
    model: options.model,
  });
  const prompt = assemblePlayerAgentPrompt({
    script: store.script,
    houseRules: store.houseRules,
    character: playerCharacter,
    clues: store.clues,
    playerNotes: store.playerNotes,
    npcs: store.npcs.filter((n) => n.knownToPlayer),
    madness: store.madness,
    location: store.location,
    chapterSummaries: store.chapterSummaries,
    recentMessages: store.messages,
    turn: store.turn,
    promptMode: handle.sendCount === 0 ? "seed" : "delta",
  });

  liveCaptured = null;
  liveChat = "";

  const onAbort = () => {
    void disposeAiPlayerSession();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    assertNotAborted(options.signal);
    await handle.session.sendText(prompt);
    handle.sendCount += 1;
    assertNotAborted(options.signal);

    const action = (liveCaptured ?? extractFallbackAction(liveChat)).trim();
    if (!action) {
      throw new Error("AI_PLAYER_NO_ACTION");
    }
    return action;
  } catch (err) {
    await disposeAiPlayerSession();
    throw err;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export async function disposeAiPlayerSession() {
  const handle = playerHandle;
  playerHandle = null;
  if (!handle) return;
  try {
    handle.disposeListeners();
  } catch {
    // ignore
  }
  try {
    await handle.session.end();
  } catch {
    // ignore
  }
}

function extractFallbackAction(chat: string): string {
  const text = chat.trim();
  if (!text) return "";
  const parts = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const err = new Error("AI_PLAYER_ABORTED");
    err.name = "AbortError";
    throw err;
  }
}
