import { defineTool } from "@kaoruisaac/pedelec";

export const submitPlayerActionTool = defineTool({
  name: "submit_player_action",
  description:
    "提交本回合玩家要採取的唯一行動（繁體中文）。每回合必須呼叫恰好一次。",
  argsSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "具體可執行的玩家行動，繁體中文，一句到一小段即可",
      },
      rationale: {
        type: "string",
        description: "可選：簡短決策理由（不會顯示給 GM，僅供除錯）",
      },
    },
    required: ["action"],
  },
});

export const playerAgentTools = [submitPlayerActionTool] as const;

export type SubmitPlayerActionArgs = {
  action: string;
  rationale?: string;
};
