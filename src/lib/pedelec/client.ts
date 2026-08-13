import { Pedelec } from "@kaoruisaac/pedelec";

export const pedelec = new Pedelec({ bridgeTimeoutMs: 30000 });

/**
 * SDK createSession：只傳 provider、不傳 model 時會再 getSettings() 取 Desktop 預設模型。
 * Desktop settings shape 不符時會 SDK_PROTOCOL_ERROR，畫面顯示就緒卻無法進劇本。
 * 一律帶上 string model（空字串 = 讓 Desktop / provider 自己補預設）。
 */
export function explicitSessionModel(model?: string | null): string {
  return (model ?? "").trim();
}
