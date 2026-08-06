import { defineTool } from "@kaoruisaac/pedelec";

export const submitCompanionActionTool = defineTool({
  name: "submit_companion_action",
  description:
    "以桌邊玩家口吻提交本回合宣告（繁體中文第一人稱）。必須同時選擇 handoff：pause=等人類玩家插話；immediate=危機中需立刻擲骰／結算。",
  argsSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description:
          "第一人稱宣告（台詞或意圖），例如「我抓起石灰粉往牠臉上撒！」勿寫骰結果或世界後果。",
      },
      handoff: {
        type: "string",
        description:
          "pause：說話／提議／分工，等玩家；immediate：危機出手需立刻檢定或改世界狀態",
        enum: ["pause", "immediate"],
      },
    },
    required: ["action", "handoff"],
  },
});

export const passCompanionTurnTool = defineTool({
  name: "pass_turn",
  description:
    "本回合選擇不動作（旁觀、等待、無介入必要）。呼叫後前端不會顯示任何提示。",
  argsSchema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "可選：內部理由（不會顯示給玩家）",
      },
    },
    required: [],
  },
});

export const companionAgentTools = [
  submitCompanionActionTool,
  passCompanionTurnTool,
] as const;
