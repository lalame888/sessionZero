import { defineTool } from "@kaoruisaac/pedelec";

export const setupScriptTool = defineTool({
  name: "setup_script",
  description:
    "初始化或更新劇本設定與（依 scenario_scale）正規劇本備註。Call when Session 0 premise is clear, and again when the solo player revises settings. Design for 1 player PC + optional AI companion PCs (recommended_party_size 1–4). Respect the player's chosen scenario_scale depth.",
  argsSchema: {
    type: "object",
    properties: {
      system_id: { type: "string", description: "COC_7E 或 DND_5E" },
      scenario_scale: {
        type: "string",
        description: "seed | oneshot | arc — 必須符合玩家選擇的規模",
      },
      recommended_party_size: {
        type: "number",
        description: "建議同行人數 1–4（含玩家）。密謀調查常 1–2，探險／對抗常 2–4。",
      },
      party_role_hints: {
        type: "array",
        description: "各席定位建議；第 1 項對應玩家可扮演的核心定位",
        items: {
          type: "object",
          properties: {
            role_title: { type: "string" },
            brief: { type: "string" },
          },
          required: ["role_title", "brief"],
        },
      },
      public_summary: {
        type: "object",
        properties: {
          title: { type: "string" },
          background: { type: "string" },
          protagonist_role: {
            type: "string",
            description: "玩家可扮演的核心定位（非整隊描述）",
          },
          genre: { type: "string" },
          player_hook: { type: "string" },
          known_facts: { type: "array", items: { type: "string" } },
          geography: { type: "string" },
        },
        required: ["title", "background", "protagonist_role", "genre"],
      },
      hidden_full_script: {
        type: "object",
        properties: {
          truth_and_secrets: { type: "string" },
          key_clues: { type: "array", items: { type: "string" } },
          winning_condition: { type: "string" },
          failure_consequences: { type: "string" },
          timeline: {
            type: "array",
            items: {
              type: "object",
              properties: {
                when: { type: "string" },
                what: { type: "string" },
              },
              required: ["when", "what"],
            },
          },
          scenes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                summary: { type: "string" },
                clues: { type: "array", items: { type: "string" } },
                dangers: { type: "array", items: { type: "string" } },
                linked_npc_ids: { type: "array", items: { type: "string" } },
              },
              required: ["id", "name", "summary"],
            },
          },
          npcs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                role: { type: "string" },
                appearance: { type: "string" },
                motivation: { type: "string" },
                knows: { type: "string" },
                attitude_to_pc: { type: "string" },
              },
              required: [
                "id",
                "name",
                "role",
                "motivation",
                "knows",
                "attitude_to_pc",
              ],
            },
          },
          creatures: {
            type: "array",
            description:
              "COC／有戰鬥威脅時必填：敵人／怪物戰鬥數值（HP、護甲、攻擊技能％與傷害骰、目擊 SAN）。人類敵對 NPC 也可列於此並用 linked_npc_id 對應 npcs。",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                kind: {
                  type: "string",
                  description: "human | monster | mythos",
                },
                attributes: {
                  type: "object",
                  properties: {
                    STR: { type: "number" },
                    CON: { type: "number" },
                    SIZ: { type: "number" },
                    DEX: { type: "number" },
                    APP: { type: "number" },
                    INT: { type: "number" },
                    POW: { type: "number" },
                    EDU: { type: "number" },
                  },
                },
                hp: { type: "number" },
                armor: { type: "number" },
                mov: { type: "number" },
                build: { type: "number" },
                damage_bonus: { type: "string" },
                attacks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      skill_pct: { type: "number" },
                      damage: { type: "string" },
                      attacks_per_round: { type: "number" },
                    },
                    required: ["name", "skill_pct", "damage"],
                  },
                },
                san_loss_on_sight: {
                  type: "string",
                  description: "如 0/1D4 或 1/1D6（成功/失敗）",
                },
                armor_notes: { type: "string" },
                powers: { type: "string" },
                combat_notes: { type: "string" },
                linked_npc_id: { type: "string" },
              },
              required: ["id", "name", "kind", "hp", "attacks"],
            },
          },
          factions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                goal: { type: "string" },
                methods: { type: "string" },
              },
              required: ["id", "name", "goal"],
            },
          },
          san_and_threats: { type: "string" },
          acts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                summary: { type: "string" },
              },
              required: ["name", "summary"],
            },
          },
        },
        required: ["truth_and_secrets", "key_clues", "winning_condition"],
      },
      recommended_creation_mode: {
        type: "string",
        description: "DICE | ARRAY | POINT_BUY | SKILL_ALLOC",
      },
      tone_examples: {
        type: "array",
        description:
          "2–4 則繁中 GM 敘事定調範例（文風／感官密度；禁止劇透 hidden 結局）",
        items: { type: "string" },
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
            description:
              "標準陣列，長度必須等於 attribute_defs。D&D 六項：[15,14,13,12,10,8]；CoC 八項：[80,70,60,60,50,50,40,40]。禁止把 D&D 陣列用在 CoC。",
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
        description:
          "ARRAY 模式可分配數值（可與 mode_config.standard_array 擇一）。長度必須＝屬性數；CoC 用 [80,70,60,60,50,50,40,40]，勿用 D&D 的 [15,14,13,12,10,8]。",
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
              description:
                "是否為職業技能（可花職業點）。CoC 職業包請標約 8 項為 true，否則 EDU×4 職業點會花不完",
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

export const fillCharacterNarrativeTool = defineTool({
  name: "fill_character_narrative",
  description:
    "依目前劇本、創角藍圖與（若有）已完成的隊友敘事，一次填滿本席角色卡所有「敘事／身分」開放欄位。若訊息含隊伍現況：避免與已完成隊友撞名／撞職／撞背景，並讓職能互補以平衡隊伍。禁止填寫屬性點數或技能配點／技能％。必須填寫完整；僅在玩家明確要求時呼叫。所有文字必須繁體中文。",
  argsSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "角色姓名（必填）" },
      role_title: {
        type: "string",
        description: "顯示職稱／別名（必填，繁中）",
      },
      age: { type: "string", description: "年齡（必填，可寫「約28歲」等）" },
      gender: {
        type: "string",
        description: "性別／自我認同（必填，自由文字）",
      },
      appearance: { type: "string", description: "外貌描述（必填，具體可見特徵）" },
      residence: {
        type: "string",
        description: "現居／活動地（必填）",
      },
      birthplace: { type: "string", description: "出生地（必填）" },
      languages: {
        type: "string",
        description: "語言（必填，逗號分隔亦可）",
      },
      personal_bio: {
        type: "string",
        description: "背景短述（必填，一段完整人物背景）",
      },
      wealth: {
        type: "string",
        description: "資產概況（必填，生活水準／經濟狀況）",
      },
      profile_coc: {
        type: "object",
        description:
          "COC_7E 必填完整物件；DND_5E 請省略。必須含 occupation 與 cash_assets。",
        properties: {
          occupation: { type: "string", description: "正式職業名（必填）" },
          cash_assets: {
            type: "string",
            description: "現金／資產細節（必填）",
          },
        },
        required: ["occupation", "cash_assets"],
      },
      profile_dnd: {
        type: "object",
        description:
          "DND_5E 必填完整物件；COC_7E 請省略。必須含下列全部子欄。",
        properties: {
          race: { type: "string", description: "種族（必填）" },
          class_name: { type: "string", description: "職業（必填）" },
          background: { type: "string", description: "背景（必填）" },
          alignment: { type: "string", description: "陣營（必填）" },
          speed: { type: "number", description: "速度英尺，通常 30（必填）" },
          proficiencies: {
            type: "string",
            description: "技能／工具／豁免／武器護甲熟練摘要（必填）",
          },
          features: {
            type: "string",
            description: "種族／職業／背景特性摘要（必填）",
          },
        },
        required: [
          "race",
          "class_name",
          "background",
          "alignment",
          "speed",
          "proficiencies",
          "features",
        ],
      },
      backstory_hooks: {
        type: "array",
        description:
          "若藍圖有 background_questions：必須涵蓋每一個 id，不可漏題；若無鉤子問題可回傳空陣列",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            answer: { type: "string", description: "繁中答案（不可空白）" },
          },
          required: ["id", "answer"],
        },
      },
      inventory: {
        type: "array",
        items: { type: "string" },
        description: "起始背包（必填，至少數件物品，繁中），會覆寫目前背包",
        minItems: 1,
      },
      player_note: {
        type: "string",
        description: "給玩家看的一句設計說明（繁中，可選）",
      },
    },
    required: [
      "name",
      "role_title",
      "age",
      "gender",
      "appearance",
      "residence",
      "birthplace",
      "languages",
      "personal_bio",
      "wealth",
      "backstory_hooks",
      "inventory",
    ],
  },
});

export const narrateStoryTool = defineTool({
  name: "narrate_story",
  description:
    "輸出主線劇情（可用 Markdown），並可選擇發起玩家可見的擲骰檢定請求。Never narrate/decide PC actions, speech, or thoughts — especially on the opening beat; end with the situation waiting for the player. Never write UI prompts like「請輸入您的下一步行動」. When check_request is present, wait for the tool result containing the dice outcome before continuing. After a dice outcome is returned, the NEXT narrate_story must ONLY narrate the check result and immediate consequences — never repeat or rewrite previously narrated scene text. Prefer setting location / scene_id / npc_updates when the scene or cast changes. Do not attach check_request on the opening beat unless the player already declared an action. narrative_text 必須為繁體中文。",
  timeoutMs: 180_000,
  argsSchema: {
    type: "object",
    properties: {
      system_notice: { type: "string" },
      narrative_text: { type: "string" },
      location: {
        type: "string",
        description:
          "當前地點短名（繁中）。進入新場景時必填，寫入 SSOT 側欄。",
      },
      scene_id: {
        type: "string",
        description: "對應 bible scenes[].id（若可知）",
      },
      scene_goal: {
        type: "string",
        description: "本場景玩家可感知的目標／壓力（一句，繁中）",
      },
      tension: {
        type: "string",
        description: "low | medium | high | climax",
      },
      director_notes: {
        type: "string",
        description: "給下一回合的導演備註（勿劇透 hidden truth）",
      },
      npc_updates: {
        type: "array",
        description: "首次會面或狀態變化的 NPC，寫入側欄",
        items: {
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
      },
      check_request: {
        type: "object",
        properties: {
          request_id: { type: "string" },
          check_target_name: {
            type: "string",
            description:
              "技能／屬性繁中名稱。盡量選角色卡既有技能（與 SSOT Skills 完全同名，如 神秘學）。CoC 理智檢定用「理智」— 前端以當前 SAN 為門檻，非技能欄。若角色卡有該技能，前端會用其數值當成功門檻。",
          },
          dice_type: {
            type: "string",
            description: "CoC 用 d100；D&D 用 d20 或 NdM。",
          },
          target_value: {
            type: "number",
            description:
              "成功門檻。角色卡有對應技能且為 CoC d100 時可省略（前端覆寫為技能％）。CoC 理智檢定（check_target_name=理智）可省略（前端覆寫為當前 SAN）。若角色卡沒有對應技能，則必須提供（CoC 為成功需 ≤ 的％；D&D 為 AC／DC）。禁止兩者皆缺。",
          },
          difficulty: {
            type: "string",
            description:
              "CoC only — 檢定難度（KP 事先要求的門檻）：regular=一般難度（≤技能）｜hard=困難難度（≤半值）｜extreme=極限難度（≤⅕）。預設 regular。與骰完後的「成功品質」（普通／困難級／極限級成功）不同。",
          },
          dnd_advantage_mode: { type: "string" },
          reason: { type: "string" },
          character_id: {
            type: "string",
            description: "檢定對象角色 id；省略則為玩家 PC",
          },
        },
        required: ["request_id", "check_target_name", "dice_type", "reason"],
      },
    },
    required: ["narrative_text"],
  },
});

export const secretCheckRequestTool = defineTool({
  name: "secret_check_request",
  description:
    "發起不向玩家展示骰子點數的 GM 隱密暗骰。盡量選角色卡既有技能；若無對應技能必須提供 target_value。",
  argsSchema: {
    type: "object",
    properties: {
      request_id: { type: "string" },
      check_target_name: {
        type: "string",
        description:
          "技能／屬性繁中名稱；盡量與 SSOT Skills 完全同名。CoC 理智檢定用「理智」（門檻＝當前 SAN）。",
      },
      dice_type: { type: "string" },
      target_value: {
        type: "number",
        description:
          "成功門檻。角色卡無對應技能時必填；有對應技能的 CoC d100 可省略。",
      },
      reason_for_gm: { type: "string" },
      character_id: {
        type: "string",
        description: "暗骰對象角色 id；省略則為玩家 PC。隊友行動時必須帶其 id。",
      },
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
  description:
    "修改角色數值、血量或背包。預設為玩家 PC；若變更 AI 隊友請帶 character_id。",
  argsSchema: {
    type: "object",
    properties: {
      character_id: {
        type: "string",
        description: "目標角色 id；省略則為玩家操控的 PC",
      },
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
      character_id: {
        type: "string",
        description: "目標角色 id；省略則為玩家 PC",
      },
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
  description:
    "宣告劇本結束，進入階段四結算畫面並解鎖幕後真相。當敘事出現全劇終／恭喜通關／epilogue 完成時必須呼叫；不可只寫結局文字而不呼叫本工具。",
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

export const requestCompanionActionTool = defineTool({
  name: "request_companion_action",
  description:
    "喚起一名 AI 隊友以桌邊玩家口吻宣告（或靜默 pass）。隊友可 pause（等人類插話）或 immediate（危機立刻結算）。勿每位每回合必叫。結算時必須對該隊友使用 character_id。",
  argsSchema: {
    type: "object",
    properties: {
      companion_id: {
        type: "string",
        description: "隊伍成員 id（與角色卡 id 相同）",
      },
      reason: {
        type: "string",
        description: "為何此刻適合喚起此隊友",
      },
      situation: {
        type: "string",
        description: "給隊友 AI 的情境摘要（可選）",
      },
      prefer_immediate: {
        type: "boolean",
        description:
          "危機中可設 true，提示隊友若出手需立刻檢定則用 handoff=immediate；最終仍由隊友決定",
      },
    },
    required: ["companion_id", "reason"],
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
  fillCharacterNarrativeTool,
  narrateStoryTool,
  secretCheckRequestTool,
  updateGameStatsTool,
  markSkillSuccessTool,
  recordClueTool,
  triggerMadnessTool,
  registerNpcTool,
  endGameSessionTool,
  requestCompanionActionTool,
  lookupRuleTool,
] as const;
