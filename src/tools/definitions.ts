import { defineTool } from "@kaoruisaac/pedelec";

export const setupScriptTool = defineTool({
  name: "setup_script",
  description:
    "初始化或更新劇本設定，確定遊戲系統與隱藏真相。Call when Session 0 premise is clear, and again when the solo player revises settings. Always design for exactly one PC (NPCs allowed).",
  argsSchema: {
    type: "object",
    properties: {
      system_id: { type: "string", description: "COC_7E 或 DND_5E" },
      public_summary: {
        type: "object",
        properties: {
          title: { type: "string" },
          background: { type: "string" },
          protagonist_role: { type: "string" },
          genre: { type: "string" },
        },
        required: ["title", "background", "protagonist_role", "genre"],
      },
      hidden_full_script: {
        type: "object",
        properties: {
          truth_and_secrets: { type: "string" },
          key_clues: { type: "array", items: { type: "string" } },
          winning_condition: { type: "string" },
        },
        required: ["truth_and_secrets", "key_clues", "winning_condition"],
      },
      recommended_creation_mode: {
        type: "string",
        description: "DICE | ARRAY | POINT_BUY | SKILL_ALLOC",
      },
    },
    required: [
      "system_id",
      "public_summary",
      "hidden_full_script",
      "recommended_creation_mode",
    ],
  },
});

export const generateCharacterSchemaTool = defineTool({
  name: "generate_character_schema",
  description:
    "產生雙軌創角規則（數值 Stats + 劇情鉤子 Hooks）。SSOT 由前端依 creation_mode 擲骰／互斥陣列／購點／雙技能點池完成，禁止在對話中直接給定最終屬性數字。所有 label／技能名／說明／鉤子問題用繁體中文。",
  argsSchema: {
    type: "object",
    properties: {
      system_id: { type: "string", description: "COC_7E 或 DND_5E" },
      creation_mode: {
        type: "string",
        description: "DICE | ARRAY | POINT_BUY | SKILL_ALLOC",
      },
      attribute_defs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", description: "如 STR、POW" },
            label: { type: "string", description: "繁中顯示名，如 力量" },
            dice_formula: {
              type: "string",
              description: "DICE 模式公式，如 4d6dl1、3d6x5、2d6+6x5",
            },
          },
          required: ["key", "label"],
        },
      },
      mode_config: {
        type: "object",
        description: "依模式的點池／陣列／技能點公式",
        properties: {
          point_buy_pool: { type: "number", description: "購點池上限" },
          standard_array: {
            type: "array",
            items: { type: "number" },
            description: "標準陣列，如 D&D [15,14,13,12,10,8]",
          },
          occupational_point_formula: {
            type: "string",
            description: "職業點公式，如 EDU * 4",
          },
          interest_point_formula: {
            type: "string",
            description: "興趣點公式，如 INT * 2",
          },
          min_score: { type: "number" },
          max_score: { type: "number" },
        },
      },
      standard_array: {
        type: "array",
        items: { type: "number" },
        description: "ARRAY 模式可分配數值（可與 mode_config.standard_array 擇一）",
      },
      point_buy: {
        type: "object",
        properties: {
          budget: { type: "number" },
          min_score: { type: "number" },
          max_score: { type: "number" },
        },
        required: ["budget", "min_score", "max_score"],
      },
      skill_points: {
        type: "number",
        description: "可選：技能點總池（若未給公式時後備）",
      },
      recommended_skills: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "技能顯示名稱，必須為繁體中文",
            },
            base_value: { type: "number" },
            is_occupational: {
              type: "boolean",
              description: "是否為職業技能（可花職業點）",
            },
            description: {
              type: "string",
              description: "技能說明，必須為繁體中文",
            },
          },
          required: ["name", "base_value", "description"],
        },
      },
      background_questions: {
        type: "array",
        description:
          "劇情鉤子問題。CoC: 信念/重要之人/地點/珍視之物；D&D: 特質/理想/羈絆/缺點",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            category: {
              type: "string",
              description: "如 重要之人、信仰、羈絆、缺點",
            },
            question: { type: "string", description: "繁中問題" },
          },
          required: ["id", "category", "question"],
        },
      },
      starting_inventory: {
        type: "array",
        items: { type: "string" },
        description: "建議起始背包（繁中）",
      },
      role_title_suggestion: {
        type: "string",
        description: "建議職稱／種族職業（繁中）",
      },
      mode_instructions: {
        type: "string",
        description: "給玩家看的創角步驟說明（繁中）",
      },
    },
    required: [
      "system_id",
      "creation_mode",
      "attribute_defs",
      "recommended_skills",
      "background_questions",
    ],
  },
});

export const narrateStoryTool = defineTool({
  name: "narrate_story",
  description:
    "輸出主線劇情（可用 Markdown），並可選擇發起玩家可見的擲骰檢定請求。When check_request is present, wait for the tool result containing the dice outcome before continuing. narrative_text 必須為繁體中文。",
  timeoutMs: 180_000,
  argsSchema: {
    type: "object",
    properties: {
      system_notice: { type: "string" },
      narrative_text: { type: "string" },
      check_request: {
        type: "object",
        properties: {
          request_id: { type: "string" },
          check_target_name: { type: "string" },
          dice_type: { type: "string" },
          target_value: { type: "number" },
          dnd_advantage_mode: { type: "string" },
          reason: { type: "string" },
        },
        required: ["request_id", "check_target_name", "dice_type", "reason"],
      },
    },
    required: ["narrative_text"],
  },
});

export const secretCheckRequestTool = defineTool({
  name: "secret_check_request",
  description: "發起不向玩家展示骰子點數的 GM 隱密暗骰。",
  argsSchema: {
    type: "object",
    properties: {
      request_id: { type: "string" },
      check_target_name: { type: "string" },
      dice_type: { type: "string" },
      target_value: { type: "number" },
      reason_for_gm: { type: "string" },
    },
    required: [
      "request_id",
      "check_target_name",
      "dice_type",
      "reason_for_gm",
    ],
  },
});

export const updateGameStatsTool = defineTool({
  name: "update_game_stats",
  description: "修改玩家的角色數值、血量或背包物品。MUST be used for any numeric/inventory change.",
  argsSchema: {
    type: "object",
    properties: {
      stat_changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            change_amount: { type: "number" },
            reason: { type: "string" },
          },
          required: ["key", "change_amount", "reason"],
        },
      },
      inventory_add: { type: "array", items: { type: "string" } },
      inventory_remove: { type: "array", items: { type: "string" } },
    },
    required: ["stat_changes"],
  },
});

export const markSkillSuccessTool = defineTool({
  name: "mark_skill_success",
  description: "標記成功檢定的技能，以便在遊戲結束時進行成長升級檢定。",
  argsSchema: {
    type: "object",
    properties: {
      skill_name: { type: "string" },
      reason: { type: "string" },
    },
    required: ["skill_name", "reason"],
  },
});

export const recordClueTool = defineTool({
  name: "record_clue",
  description: "記錄玩家發現的檔案、日記、照片或任務線索。",
  argsSchema: {
    type: "object",
    properties: {
      clue_id: { type: "string" },
      title: { type: "string" },
      content: { type: "string" },
      type: { type: "string" },
      is_key_clue: { type: "boolean" },
    },
    required: ["clue_id", "title", "content", "type", "is_key_clue"],
  },
});

export const triggerMadnessTool = defineTool({
  name: "trigger_madness",
  description: "當玩家理智崩潰或受負面狀態影響時觸發狂氣症狀。",
  argsSchema: {
    type: "object",
    properties: {
      type: { type: "string" },
      phobia_or_mania_name: { type: "string" },
      duration_turns: { type: "number" },
      effect_description: { type: "string" },
    },
    required: [
      "type",
      "phobia_or_mania_name",
      "duration_turns",
      "effect_description",
    ],
  },
});

export const registerNpcTool = defineTool({
  name: "register_npc",
  description: "登記登場 NPC 的名字、態度與生死狀態。",
  argsSchema: {
    type: "object",
    properties: {
      npc_id: { type: "string" },
      name: { type: "string" },
      relation: { type: "string" },
      status: { type: "string" },
      description: { type: "string" },
    },
    required: ["npc_id", "name", "relation", "status", "description"],
  },
});

export const endGameSessionTool = defineTool({
  name: "end_game_session",
  description: "宣告劇本結束，進入階段四結算畫面並解鎖幕後真相。",
  argsSchema: {
    type: "object",
    properties: {
      ending_type: { type: "string" },
      ending_title: { type: "string" },
      ending_narrative: { type: "string" },
      achievements: { type: "array", items: { type: "string" } },
    },
    required: ["ending_type", "ending_title", "ending_narrative"],
  },
});

export const lookupRuleTool = defineTool({
  name: "lookup_rule",
  description: "引用官方 SRD 規則或玩家自訂房規說明複雜判決依據。",
  argsSchema: {
    type: "object",
    properties: {
      rule_topic: { type: "string" },
      applied_reason: { type: "string" },
      rule_reference_text: { type: "string" },
    },
    required: ["rule_topic", "applied_reason", "rule_reference_text"],
  },
});

export const allSessionTools = [
  setupScriptTool,
  generateCharacterSchemaTool,
  narrateStoryTool,
  secretCheckRequestTool,
  updateGameStatsTool,
  markSkillSuccessTool,
  recordClueTool,
  triggerMadnessTool,
  registerNpcTool,
  endGameSessionTool,
  lookupRuleTool,
] as const;
