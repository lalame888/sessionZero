import { defineTool } from "@kaoruisaac/pedelec";

export const submitCompanionActionTool = defineTool({
  name: "submit_companion_action",
  description:
    "提交此 AI 隊友本回合要採取的行動（繁體中文）。若決定行動則呼叫此工具。",
  argsSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "具體可執行的隊友行動，繁體中文",
      },
    },
    required: ["action"],
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
