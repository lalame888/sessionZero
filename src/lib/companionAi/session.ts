import type { ProviderCode } from "@kaoruisaac/pedelec";
import { assembleCompanionAgentPrompt } from "@/lib/companionAi/context";
import { COMPANION_AGENT_DIRECTIVES } from "@/lib/companionAi/directives";
import { companionAgentTools } from "@/lib/companionAi/tools";
import { resolveAvailableProvider } from "@/lib/pedelec/resolveProvider";
import { pedelec } from "@/lib/pedelec/client";
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

function parseHandoff(raw: unknown): CompanionHandoff {
  return raw === "immediate" ? "immediate" : "pause";
}

/**
 * 短命 session：請 AI 隊友決定行動或靜默 pass。
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

  const prompt = assembleCompanionAgentPrompt({
    script: store.script,
    houseRules: store.houseRules,
    companion: member.sheet,
    party: store.party,
    playerMemberId: store.playerMemberId,
    clues: store.clues,
    npcs: store.npcs,
    madness: store.madness,
    location: store.location,
    chapterSummaries: store.chapterSummaries,
    recentMessages: store.messages,
    turn: store.turn,
    reason: options.reason,
    situation: options.situation,
    preferImmediate: options.preferImmediate,
  });

  const session = await pedelec.createSession({
    provider,
    model: model || undefined,
    skills: {
      guidance: COMPANION_AGENT_DIRECTIVES,
      tools: [...companionAgentTools],
    },
    autoEndOnDisconnect: false,
  });

  let decision: CompanionDecision = { acted: false };
  let lastChat = "";

  const offChat = session.onChat((delta) => {
    lastChat += delta;
  });

  const offAct = session.onTool(
    "submit_companion_action",
    (args: { action?: string; handoff?: string }) => {
      const action = String(args?.action ?? "").trim();
      if (action) {
        decision = {
          acted: true,
          action,
          companionName: member.sheet.name || "隊友",
          companionId: member.id,
          handoff: parseHandoff(args?.handoff),
        };
      }
      return { ok: true };
    },
  );

  const offPass = session.onTool("pass_turn", () => {
    decision = { acted: false };
    return { ok: true, passed: true };
  });

  const onAbort = () => {
    void safeEnd(session);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    assertNotAborted(options.signal);
    await session.sendText(prompt);
    assertNotAborted(options.signal);
    if (!decision.acted && lastChat.trim()) {
      // 未呼叫 tool 時不把 chat 當行動（避免誤顯示）
      decision = { acted: false };
    }
    return decision;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    offChat();
    offAct();
    offPass();
    await safeEnd(session);
  }
}

async function safeEnd(session: { end: () => Promise<void> }) {
  try {
    await session.end();
  } catch {
    // ignore
  }
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const err = new Error("COMPANION_ABORTED");
    err.name = "AbortError";
    throw err;
  }
}
