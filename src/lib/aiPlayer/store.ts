import { create } from "zustand";

export type AiPlayerPhase =
  | "idle"
  | "thinking"
  | "waiting_gm"
  | "rolling"
  | "error";

interface AiPlayerStore {
  /** 開關：持續代打直到關閉或遊戲結束 */
  enabled: boolean;
  phase: AiPlayerPhase;
  lastError: string | null;
  lastAction: string | null;
  /** 本輪代打次數（此開關開啟期間） */
  turnCount: number;

  setEnabled: (v: boolean) => void;
  setPhase: (p: AiPlayerPhase) => void;
  setLastError: (e: string | null) => void;
  setLastAction: (a: string | null) => void;
  bumpTurnCount: () => void;
  resetRuntime: () => void;
}

export const useAiPlayerStore = create<AiPlayerStore>((set) => ({
  enabled: false,
  phase: "idle",
  lastError: null,
  lastAction: null,
  turnCount: 0,

  setEnabled: (v) =>
    set((s) =>
      v
        ? { enabled: true, lastError: null, phase: "idle" }
        : {
            enabled: false,
            phase: "idle",
            turnCount: 0,
            lastAction: s.lastAction,
          },
    ),
  setPhase: (p) => set({ phase: p }),
  setLastError: (e) => set({ lastError: e, phase: e ? "error" : "idle" }),
  setLastAction: (a) => set({ lastAction: a }),
  bumpTurnCount: () => set((s) => ({ turnCount: s.turnCount + 1 })),
  resetRuntime: () =>
    set({
      enabled: false,
      phase: "idle",
      lastError: null,
      lastAction: null,
      turnCount: 0,
    }),
}));
