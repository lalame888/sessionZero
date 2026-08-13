/**
 * GM provider 記憶／token 政策常數。
 * 詳見 doc/gm-memory-and-tokens.md
 */

/** 每累積幾次 session.sendText 後重建 provider conversation（壓縮） */
export const PROVIDER_COMPACT_EVERY = 5;

/** 獨立短 session（隊友／AI 玩家）續聊幾次後重建，避免 thread 膨脹 */
export const SIDE_SESSION_REUSE_EVERY = 4;

/** turn prompt 組裝模式 */
export type GmPromptMode = "seed" | "delta";
