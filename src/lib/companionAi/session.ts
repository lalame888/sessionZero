import type { PedelecSession, ProviderCode } from "@kaoruisaac/pedelec";
import { assembleCompanionAgentPrompt } from "@/lib/companionAi/context";
import { COMPANION_AGENT_DIRECTIVES } from "@/lib/companionAi/directives";
import {
  formatCompanionLookupGameState,
  formatCompanionLookupHistory,
} from "@/lib/companionAi/lookup";
import { companionAgentTools } from "@/lib/companionAi/tools";
import { resolveAvailableProvider } from "@/lib/pedelec/resolveProvider";
import { explicitSessionModel, pedelec } from "@/lib/pedelec/client";
import { useGameStore } from "@/store/useGameStore";

export type CompanionHandoff = "pause" | "immediate";

export type CompanionDecision =
  | { acted: false }
  | {
      acted: true;
      action: string;
      companionName: string;
      companionId: string;
      handoff: CompanionHandoff;
    };

type CompanionToolName = (typeof companionAgentTools)[number]["name"];

type CompanionHandle = {
  session: PedelecSession<CompanionToolName>;
  disposeListeners: () => void;
  companionId: string;
};

/** 每位隊友各自一條 side session（不共用 provider thread）。 */
const companionHandles = new Map<string, CompanionHandle>();
let lastActiveCompanionId: string | null = null;

const live = {
  action: null as string | null,
  handoff: "pause" as CompanionHandoff,
  chat: "",
};

function parseHandoff(raw: unknown): CompanionHandoff {
  return raw === "immediate" ? "immediate" : "pause";
}

function parseHistoryScope(raw: unknown): "chapters" | "recent" | "both" {
  const s = String(raw ?? "").trim();
  if (s === "chapters" || s === "recent") return s;
  return "both";
}

async function endCompanionHandle(handle: CompanionHandle) {
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

/**
 * 釋放隊友 session。不帶 id 時清掉全部（主 GM session 結束時用）。
 */
export async function disposeCompanionSession(companionId?: string) {
  if (companionId) {
    const handle = companionHandles.get(companionId);
    companionHandles.delete(companionId);
    if (handle) await endCompanionHandle(handle);
    if (lastActiveCompanionId === companionId) {
      lastActiveCompanionId = null;
    }
    return;
  }
  const ids = [...companionHandles.keys()];
  for (const id of ids) {
    await disposeCompanionSession(id);
  }
  lastActiveCompanionId = null;
}

async function switchCompanionSession(companionId: string) {
  if (lastActiveCompanionId && lastActiveCompanionId !== companionId) {
    await disposeCompanionSession(lastActiveCompanionId);
  }
  await disposeCompanionSession(companionId);
  lastActiveCompanionId = companionId;
}

async function createCompanionSession(options: {
  companionId: string;
  provider: ProviderCode;
  model?: string;
}): Promise<CompanionHandle> {
  const session = await pedelec.createSession({
    provider: options.provider,
    model: explicitSessionModel(options.model),
    skills: {
      guidance: COMPANION_AGENT_DIRECTIVES,
      tools: [...companionAgentTools],
    },
    autoEndOnDisconnect: false,
  });

  const companionId = options.companionId;

  const offChat = session.onChat((delta) => {
    live.chat += delta;
  });

  const offLookupState = session.onTool(
    "lookup_game_state",
    (args: { focus?: string }) => {
      const store = useGameStore.getState();
      const text = formatCompanionLookupGameState({
        script: store.script,
        houseRules: store.houseRules,
        companionId,
        party: store.party,
        playerMemberId: store.playerMemberId,
        clues: store.clues,
        npcs: store.npcs.filter((n) => n.knownToPlayer),
        playerNotes: store.playerNotes,
        location: store.location,
        turn: store.turn,
        sceneDirector: store.sceneDirector,
        focus: args?.focus,
      });
      return { ok: true, text };
    },
  );

  const offLookupHistory = session.onTool(
    "lookup_history",
    (args: { scope?: string; query?: string; limit?: number }) => {
      const store = useGameStore.getState();
      const text = formatCompanionLookupHistory({
        chapterSummaries: store.chapterSummaries,
        recentMessages: store.messages,
        scope: parseHistoryScope(args?.scope),
        query: args?.query,
        limit: args?.limit,
      });
      return { ok: true, text };
    },
  );

  const offAct = session.onTool(
    "submit_companion_action",
    (args: { action?: string; handoff?: string }) => {
      const action = String(args?.action ?? "").trim();
      if (action) {
        live.action = action;
        live.handoff = parseHandoff(args?.handoff);
      }
      return { ok: true };
    },
  );

  const offPass = session.onTool("pass_turn", () => {
    live.action = null;
    return { ok: true, passed: true };
  });

  const handle: CompanionHandle = {
    session,
    companionId,
    disposeListeners: () => {
      offChat();
      offLookupState();
      offLookupHistory();
      offAct();
      offPass();
    },
  };
  companionHandles.set(companionId, handle);
  return handle;
}

/**
 * 每次喚起：切換隊友時清 thread、一律 SEED prompt、結束後釋放該席 session。
 */
export async function requestCompanionDecision(options: {
  companionId: string;
  reason: string;
  situation?: string;
  preferImmediate?: boolean;
  provider?: ProviderCode;
  model?: string;
  signal?: AbortSignal;
}): Promise<CompanionDecision> {
  assertNotAborted(options.signal);

  const store = useGameStore.getState();
  const member = store.party.find(
    (m) => m.id === options.companionId || m.sheet.id === options.companionId,
  );
  if (!member || member.controller !== "ai") {
    return { acted: false };
  }

  const { provider, model } = options.provider
    ? { provider: options.provider, model: options.model }
    : await resolveAvailableProvider({
        providerOverride: store.selectedProvider,
        modelOverride: store.selectedModel || undefined,
      });

  await switchCompanionSession(member.id);

  const prompt = assembleCompanionAgentPrompt({
    script: store.script,
    companion: member.sheet,
    location: store.location,
    turn: store.turn,
    reason: options.reason,
    situation: options.situation,
    preferImmediate: options.preferImmediate,
  });

  live.action = null;
  live.handoff = "pause";
  live.chat = "";

  const onAbort = () => {
    void disposeCompanionSession(member.id);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  let handle: CompanionHandle | null = null;

  try {
    assertNotAborted(options.signal);
    handle = await createCompanionSession({
      companionId: member.id,
      provider,
      model: model || undefined,
    });

    if (handle.session.getStatus() !== "idle") {
      await disposeCompanionSession(member.id);
      return requestCompanionDecision(options);
    }

    await handle.session.sendText(prompt);
    assertNotAborted(options.signal);

    if (live.action) {
      return {
        acted: true,
        action: live.action,
        handoff: live.handoff,
        companionName: member.sheet.name || "隊友",
        companionId: member.id,
      };
    }
    return { acted: false };
  } catch (err) {
    await disposeCompanionSession(member.id);
    throw err;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    await disposeCompanionSession(member.id);
  }
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const err = new Error("COMPANION_ABORTED");
    err.name = "AbortError";
    throw err;
  }
}
