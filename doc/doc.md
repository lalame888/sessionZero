# 📜 SessionZero — 萬用 AI TRPG 跑團引擎規格書 (v7.2 旗艦硬核完整版)

專案名稱取自 TRPG 經典術語 **「Session 0」**——代表玩家與 GM 在跑團前進行劇本討論、系統挑選與創角的關鍵階段。本系統為一個具備嚴謹規則控管、自訂房規支援、零 API Key 負擔且完全不產生數值與規則幻覺的通用型單人 Web 跑團引擎。

---

## 1. 專案總覽與 Pedelec 整合架構

### 1.1 專案目標與核心理念

* **零 API Key 費用負擔 (BYO-AI)**：整合 `@kaoruisaac/pedelec` 框架，玩家透過本機 CLI/Agent (OpenAI, Anthropic, Ollama 等) 提供 AI 算力，開發者無需託管後端與支付 API Key 費用。


* **Pedelec 整合層級：`Required Integration**`：本應用的核心體驗由 Agent 驅動。進入頁面時立即執行預檢 (`getApprovalStatus` 與 `listProviders`)，未連線前禁用主要遊戲輸入控制。


* **萬用多系統架構 (System-Agnostic Engine)**：以 `system_id` 動態驅動 **CoC 7th（克蘇魯/懸疑/d100）** 與 **D&D 5e（奇幻/戰鬥/d20）** 兩種全然不同的介面與規則引擎。
* **前端為單一真實數據源（SSOT）**：血量（HP/AC/SAN）、屬性修正值、法術位、技能點數、暗骰判定與歷史快照完全由前端 Zustand 狀態庫掌控，徹底杜絕 LLM 的數值幻覺與計算錯誤。
* **雙軌儀式感創角（Stage 2 Creation）**：結合前端 MathJS 即時衍生計算（HP/MP/SAN/AC/Modifiers）與劇情鉤子（Backstory Hooks），達成數值驗證與故事背景的雙重綁定。
* **四層規則防線 (4-Tier Rule Engine)**：整合硬規則 SSOT、自訂房規（House Rules）注入、官方 SRD 關鍵檢索與透明規則查詢 API，完美征服硬核「規則律師」玩家。
* **嚴格 GM 契約與邊界控制**：導入業界最佳實踐，嚴禁 AI 「越俎代庖（God-moding）」幫玩家做決定或講話。
* **三層式動態記憶架構 (3-Tier Context Architecture)**：結合歷史章節自動壓縮（Summarization）與即時狀態注入，確保長劇本對話不遺忘、不爆 Token。

### 1.2 技術棧規格 (Tech Stack)

* **前端框架**：React + Vite 8
* **AI 協議與 SDK**：`@kaoruisaac/pedelec`

* **UI 視覺庫**：Tailwind CSS + Shadcn/ui + Lucide Icons (支援暗黑哥德風與古典奇幻風動態主題)
* **全域狀態管理**：Zustand（管理角色卡、線索/任務庫、NPC 名冊、暗骰佇列、房規設定與歷史快照）
* **公式演算引擎**：`mathjs`（安全解析屬性修正值與衍生數值公式）

---

## 2. 核心 AI 記憶架構、GM 契約與四層規則防線

### 2.1 嚴格 GM 契約五大原則 (Strict GM Directives)

在發送給 AI 的 System Prompt 中寫死以下行為邊界：

1. **嚴禁替代控制（No God-moding）**：AI 絕對不能描述、決定玩家角色（PC）的內心想法、台詞或動作。敘事推進到需要玩家反應時，必須立即停止輸出。
2. **遵守骰點結果（Outcome Permanence）**：當檢定失敗或大失敗時，AI 必須給予實質且不可逆的負面代價，嚴禁無條件救場或無損放水。
3. **資訊不對稱屏障（Information Barrier）**：AI 嚴禁洩漏 `hidden_full_script` 的真相，除非玩家透過成功的檢定解鎖線索。
4. **強制 Tool 執行（Mandatory Tool Call）**：任何數值、血量、理智或背包變動，AI **必須觸發對應 Tool API**，嚴禁僅在文字對話中提及。
5. **房規優先原則（House Rules First）**：嚴格遵守玩家設定的自訂房規，若與官方 SRD 衝突，**房規永遠具備最高優先權**。

### 2.2 四層規則防線機制 (4-Tier Rule Protection)

1. **第一層：硬規則 SSOT（Hard Rules）**：數值、計數器、法術位扣減由前端 Zustand + MathJS 引擎寫死，不交由 AI 自由發揮。
2. **第二層：自訂房規匯入（House Rules / Homebrew Box）**：玩家在 Stage 1 可勾選或貼上自訂房規（例如：`D&D 5e 喝治療藥水算附贈動作`、`CoC 7e 允許使用幸運值抵扣點數`），前端動態注入背景 System Directive。
3. **第三層：SRD 結構化知識庫 (SRD Lorebook)**：內建精簡版 D&D 5e / CoC 7e SRD。當玩家觸發關鍵字（如 `[法術: 火球術]`、`[動作: 借機攻擊]`）時，前端自動從本地 SRD 庫抓取 3 行精準條文併入 Context。
4. **第四層：透明規則判決 API (`lookup_rule`)**：AI 在進行複雜戰術判決時，可主動呼叫此 API 說明判決依據與引用條文，提供可被檢驗的透明度。

### 2.3 三層式動態記憶架構 (3-Tier Context Assembly)

每次發送對話給 Pedelec Session 時，前端自動將 Context 組裝為以下結構：

```
┌──────────────────────────────────────────────────────────┐
│ [Top Layer] 系統 Prompt 指令 + 劇本隱藏真相 (Hidden Truth) │ ➔ 永遠固定在最頂部
├──────────────────────────────────────────────────────────┤
│ [Middle Layer 1] 自訂房規 & SRD 條文 (House Rules & SRD)   │ ➔ 玩家輸入動態觸發/房規注入
├──────────────────────────────────────────────────────────┤
│ [Middle Layer 2] 歷史章節摘要 (Chapter Summaries)          │ ➔ 舊對話每 15 輪自動壓縮
├──────────────────────────────────────────────────────────┤
│ [Bottom Layer 1] 滾動對話視窗 (Sliding Window: 近 8-10 輪) │ ➔ 保留最近完整的原始對話
├──────────────────────────────────────────────────────────┤
│ [Bottom Layer 2] SSOT 即時狀態注入 (Context Injection)   │ ➔ 永遠置底 (確保最高優先級)
└──────────────────────────────────────────────────────────┘

```

---

## 3. 跨系統萬用遊戲引擎與創角雙軌機制

### 3.1 萬用擲骰解析器 (Universal Dice Roller)

前端內建獨立擲骰引擎，支援標準 TRPG 語法解析：

* **CoC 模式 (`1d100`)**：
* **大成功**：$1$ ｜ **極限成功**：$\le \lfloor \frac{\text{Target}}{5} \rfloor$ ｜ **困難成功**：$\le \lfloor \frac{\text{Target}}{2} \rfloor$ ｜ **成功**：$\le \text{Target}$ ｜ **失敗**：$> \text{Target}$ ｜ **大失敗**：$\ge 96$


* **D&D 模式 (`1d20 + bonus`)**：
* **常規 (NORMAL)**：$1 \sim 20$ 亂數 + 修正值 $\ge \text{DC}$。
* **優勢 (ADVANTAGE)**：生成 2 次 1d20 取大值 + 修正值。
* **劣勢 (DISADVANTAGE)**：生成 2 次 1d20 取小值 + 修正值。
* **自然 20（Nat 20）**：大成功 ｜ **自然 1（Nat 1）**：大失敗。



### 3.2 創角雙軌與衍生數值驗證機制 (Stage 2 Focus)

創角分為 **「數值面板 (Stats)」** 與 **「劇情鉤子 (Hooks)」** 雙軌：

#### 1. 四種創角模式 UI 限制 (SSOT Guardrails)

* **🎲 物理擲骰 (DICE)**：前端觸發 JS `Math.random()` 亂數，禁止手動修改（CoC 生成 $3\text{d}6 \times 5$ / $(2\text{d}6+6) \times 5$；D&D 生成 $4\text{d}6$ 去最低值）。
* **🔢 標準陣列 (ARRAY)**：呈現固定下拉選單（D&D: `[15,14,13,12,10,8]`；CoC: `[80,70,60,60,50,50,40,40]`），啟用 **互斥選項邏輯**。
* **💰 購點制 (POINT_BUY)**：點數池即時動態扣減，屬性超出允許區間（如 D&D 8~15）時 `+` / `-` 按鈕自動禁用。
* **🎯 技能分配 (SKILL_ALLOC)**：顯示職業點（如 CoC $\text{EDU} \times 4$）與個人興趣點（$\text{INT} \times 2$）剩餘量，單項技能超過 80% 跳出警告。

#### 2. MathJS 動態衍生公式 Engine

當屬性變動時，前端即時觸發 MathJS 計算，無需經過 AI：

* **CoC 7th**：
* $\text{Max HP} = \lfloor \frac{\text{STR} + \text{SIZ}}{10} \rfloor$
* $\text{Max MP} = \lfloor \frac{\text{POW}}{5} \rfloor$
* $\text{Initial SAN} = \text{POW}$
* $\text{Dodge} = \lfloor \frac{\text{DEX}}{2} \rfloor$


* **D&D 5e**：
* $\text{Ability Modifier} = \lfloor \frac{\text{Score} - 10}{2} \rfloor$
* $\text{Base AC} = 10 + \text{DEX Modifier}$
* $\text{Lvl 1 HP} = \text{Hit Die Max} + \text{CON Modifier}$



#### 3. 劇情鉤子 (Backstory Hooks)

* **CoC 7e**：填寫信念/信仰、重要之人、意義非凡的地點、珍視之物。狂氣發作時 AI 強制讀取這些錨點發動精神衝擊。
* **D&D 5e**：填寫個性特質（Traits）、理想（Ideals）、羈絆（Bonds）、缺點（Flaws），做為 AI 頒發靈感點（Inspiration）與專屬 NPC 觸發的依據。

---

## 4. 遊戲四大階段與運作流程

```
[階段一：Session 0 劇本討論、系統與房規選擇] ➔ [階段二：雙軌創角/檔案庫匯入] ➔ [階段三：遊戲主迴圈] ➔ [階段四：結算、成長與上帝視角]

```

### 階段一：Session 0 劇本討論與系統/房規選擇

1. 網頁載入時呼叫 `checkPedelecPrerequisites()`。若未就緒，渲染 `<PedelecInstallationGuideline/>` 指引使用者。


2. 連線成功後，建立 `session = await pedelec.createSession({ provider, skills: { tools: allSessionTools } })`。


3. 玩家輸入故事想法，AI 呼叫 `setup_script` 傳回 `system_id`（`COC_7E` 或 `DND_5E`）、公開簡介與隱藏劇本真相。
4. 玩家選定創角機制，並在「房規設定區」勾選或上傳個人自訂房規。

### 階段二：角色卡設定與雙軌建構

1. 前端可選擇「建立新角色」或「從檔案庫匯入舊角色 (`.json`)」。
2. 若建立新角，前端呼叫 `generate_character_schema` 取得該系統的欄位與推薦技能。
3. 玩家進行屬性分配、MathJS 即時衍生計算與劇情鉤子填寫。完成後存入檔案庫（Vault）。

### 階段三：遊戲主迴圈（Game Loop）

1. 玩家輸入對話或點擊 Quick Action 按鈕。
2. AI 敘事並隨時呼叫 Tool：
* **明骰** (`narrate_story`)：跳出「擲骰視窗」，玩家點擊後前端產出骰點帶回 AI。
* **暗骰** (`secret_check_request`)：前端背景完成判定，玩家 UI 不顯示數字，直接回傳給 AI。
* **規則說明** (`lookup_rule`)：AI 引用 SRD 或房規說明複雜判決依據。
* **狀態與線索** (`update_game_stats`, `record_clue`, `trigger_madness`, `register_npc`)：更新側邊欄 UI。
* **結束** (`end_game_session`)：推進至階段四。



### 階段四：結算、成長與上帝視角

1. 觸發結局，解鎖並展示 `hidden_full_script` 隱藏真相。
2. 根據 `system_id` 執行 CoC 技能成長檢定或 D&D 經驗值結算。
3. **時間軸拉桿（Timeline Scrubber）**：拖拉進度條查看歷史快照與暗骰數字對照。

---

## 5. Pedelec 連線與 Session 生命週期

### 5.1 客戶端建立與預檢 (Preflight Check)

```typescript
import { Pedelec } from "@kaoruisaac/pedelec";

// 1. 建立 Pedelec Client 實例
export const pedelec = new Pedelec({ bridgeTimeoutMs: 30000 });

// 2. 檢查連線與 Provider 可用性
export async function checkPedelecPrerequisites() {
  const approval = await pedelec.getApprovalStatus();
  if (!approval.installed || !approval.approved) {
    return { ready: false, reason: "NEEDS_INSTALLATION" };
  }

  const providers = await pedelec.listProviders();
  const availableProvider = providers.find((p) => p.available);
  if (!availableProvider) {
    return { ready: false, reason: "NO_AVAILABLE_PROVIDER" };
  }

  return { ready: true, provider: availableProvider.code };
}

```

---

## 6. 完整 11 大 Pedelec Tool Definitions (`@kaoruisaac/pedelec` 標準)

```typescript
import { defineTool } from "@kaoruisaac/pedelec";

// Tool 1: 劇本初始化
export const setupScriptTool = defineTool({
  name: "setup_script",
  description: "初始化或更新劇本設定，確定遊戲系統與隱藏真相。",
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
          genre: { type: "string" }
        },
        required: ["title", "background", "protagonist_role", "genre"]
      },
      hidden_full_script: {
        type: "object",
        properties: {
          truth_and_secrets: { type: "string" },
          key_clues: { type: "array", items: { type: "string" } },
          winning_condition: { type: "string" }
        },
        required: ["truth_and_secrets", "key_clues", "winning_condition"]
      },
      recommended_creation_mode: { type: "string", description: "DICE | ARRAY | POINT_BUY | SKILL_ALLOC" }
    },
    required: ["system_id", "public_summary", "hidden_full_script", "recommended_creation_mode"]
  }
});

// Tool 2: 產生創角規則 (雙軌增強版)
export const generateCharacterSchemaTool = defineTool({
  name: "generate_character_schema",
  description: "根據選定的遊戲系統生成創角規則、點數池配置、建議技能池與劇情鉤子背景問題。",
  argsSchema: {
    type: "object",
    properties: {
      system_id: { type: "string", description: "COC_7E 或 DND_5E" },
      creation_mode: { type: "string", description: "DICE | ARRAY | POINT_BUY | SKILL_ALLOC" },
      mode_config: {
        type: "object",
        properties: {
          point_buy_pool: { type: "number", description: "購點池上限" },
          standard_array: { type: "array", items: { type: "number" }, description: "標準陣列" },
          occupational_point_formula: { type: "string", description: "職業點數算式" }
        }
      },
      recommended_skills: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            base_value: { type: "number" },
            is_occupational: { type: "boolean" },
            description: { type: "string" }
          },
          required: ["name", "base_value", "description"]
        }
      },
      background_questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            category: { type: "string", description: "例如 '重要之人', '信仰', '羈絆', '缺點'" },
            question: { type: "string" }
          },
          required: ["id", "category", "question"]
        }
      }
    },
    required: ["system_id", "creation_mode", "recommended_skills", "background_questions"]
  }
});

// Tool 3: 故事敘事與明骰請求
export const narrateStoryTool = defineTool({
  name: "narrate_story",
  description: "輸出主線劇情，並可選擇發起玩家可見的擲骰檢定請求。",
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
          reason: { type: "string" }
        },
        required: ["request_id", "check_target_name", "dice_type", "reason"]
      }
    },
    required: ["narrative_text"]
  }
});

// Tool 4: GM 暗骰請求
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
      reason_for_gm: { type: "string" }
    },
    required: ["request_id", "check_target_name", "dice_type", "reason_for_gm"]
  }
});

// Tool 5: 修改遊戲屬性與物品
export const updateGameStatsTool = defineTool({
  name: "update_game_stats",
  description: "修改玩家的角色數值、血量或背包物品。",
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
            reason: { type: "string" }
          },
          required: ["key", "change_amount", "reason"]
        }
      },
      inventory_add: { type: "array", items: { type: "string" } },
      inventory_remove: { type: "array", items: { type: "string" } }
    },
    required: ["stat_changes"]
  }
});

// Tool 6: 標記技能成功 (用於幕間成長)
export const markSkillSuccessTool = defineTool({
  name: "mark_skill_success",
  description: "標記成功檢定的技能，以便在遊戲結束時進行成長升級檢定。",
  argsSchema: {
    type: "object",
    properties: {
      skill_name: { type: "string" },
      reason: { type: "string" }
    },
    required: ["skill_name", "reason"]
  }
});

// Tool 7: 記錄線索與任務
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
      is_key_clue: { type: "boolean" }
    },
    required: ["clue_id", "title", "content", "type", "is_key_clue"]
  }
});

// Tool 8: 觸發狂氣與異常狀態
export const triggerMadnessTool = defineTool({
  name: "trigger_madness",
  description: "當玩家理智崩潰或受負面狀態影響時觸發狂氣症狀。",
  argsSchema: {
    type: "object",
    properties: {
      type: { type: "string" },
      phobia_or_mania_name: { type: "string" },
      duration_turns: { type: "number" },
      effect_description: { type: "string" }
    },
    required: ["type", "phobia_or_mania_name", "duration_turns", "effect_description"]
  }
});

// Tool 9: 登記 NPC 狀態
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
      description: { type: "string" }
    },
    required: ["npc_id", "name", "relation", "status", "description"]
  }
});

// Tool 10: 觸發結局與結束遊戲
export const endGameSessionTool = defineTool({
  name: "end_game_session",
  description: "宣告劇本結束，進入階段四結算畫面並解鎖幕後真相。",
  argsSchema: {
    type: "object",
    properties: {
      ending_type: { type: "string" },
      ending_title: { type: "string" },
      ending_narrative: { type: "string" },
      achievements: { type: "array", items: { type: "string" } }
    },
    required: ["ending_type", "ending_title", "ending_narrative"]
  }
});

// Tool 11: 規則說明與條文引用
export const lookupRuleTool = defineTool({
  name: "lookup_rule",
  description: "引用官方 SRD 規則或玩家自訂房規說明複雜判決依據。",
  argsSchema: {
    type: "object",
    properties: {
      rule_topic: { type: "string" },
      applied_reason: { type: "string" },
      rule_reference_text: { type: "string" }
    },
    required: ["rule_topic", "applied_reason", "rule_reference_text"]
  }
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
  lookupRuleTool
] as const;

```

---

## 7. TypeScript 通用資料結構

```typescript
export type GameSystemID = 'COC_7E' | 'DND_5E' | 'CUSTOM_RPG';

// --- 通用角色卡結構 (支援雙軌與衍生計算) ---
export interface UniversalCharacterSheet {
  id: string;
  system_id: GameSystemID;
  name: string;
  role_title: string; // CoC 職業 / D&D 種族與職業 (例: "4級 矮人戰士")
  
  attributes: Record<string, number>; // CoC: STR=60 / D&D: STR=16
  attribute_modifiers?: Record<string, number>; // D&D 專用: STR_MOD=+3
  
  derived: {
    hp: { current: number; max: number };
    mp_or_slots?: { current: number; max: number }; // CoC MP 或 D&D 法術位
    san?: { current: number; max: number }; // CoC 理智值
    ac?: number; // D&D 護甲值
    proficiency_bonus?: number; // D&D 熟練加成
  };
  
  skills: Record<string, number>;
  markedSkillsForGrowth?: string[]; // CoC 待成長技能
  inventory: string[];
  
  // 雙軌劇情鉤子
  backstory_hooks: Record<string, string>; // 重要之人、信仰、羈絆、缺點等
}

// --- 房規、線索、狂氣與 NPC 模組 ---
export interface HouseRuleConfig {
  preset_rules: string[]; // 預設勾選的房規列表
  custom_rules_text: string; // 玩家自訂的擴充文字房規
}

export interface ClueItem {
  clue_id: string;
  title: string;
  content: string;
  type: 'DOCUMENT' | 'PHOTO' | 'ITEM_INSPECTION' | 'LOCATION_MEMO' | 'QUEST_LOG';
  is_key_clue: boolean;
}

export interface MadnessStatus {
  active: boolean;
  type?: 'TEMPORARY' | 'INDEFINITE' | 'PERMANENT';
  name?: string;
  duration_turns?: number;
  effect_description?: string;
}

export interface NPCItem {
  npc_id: string;
  name: string;
  relation: 'ALLY' | 'NEUTRAL' | 'SUSPECT' | 'ENEMY';
  status: 'ALIVE' | 'DEAD' | 'MISSING' | 'INSANE';
  description: string;
}

// --- 三層記憶與歷史快照 ---
export interface HistoryLog {
  turn: number;
  timestamp: number;
  playerInput?: string;
  aiNarrative: string;
  diceRecord?: {
    skillName: string;
    isSecret: boolean;
    diceType: string;
    targetValue?: number;
    diceResult: number;
    outcome: string;
  };
  snapshot: {
    character: UniversalCharacterSheet;
    clues: ClueItem[];
    npcs: NPCItem[];
    madness?: MadnessStatus;
  };
}

```

---

## 8. 開發任務實作藍圖 (Task Breakdown)

### Task 1: 基建與 Zustand 萬用狀態庫搭建

* 初始化 React + Vite 8，配置 Tailwind CSS + Shadcn/ui。
* 安裝 `@kaoruisaac/pedelec`、`zustand` 與 `mathjs`。


* 建立 `useGameStore.ts`，實現通用屬性公式引擎（動態支援 CoC 與 D&D 屬性修正值算式）、房規 Store、三層記憶 Snapshot 與 Undo 機制。

### Task 2: Pedelec 連線與 Session 0 系統/房規選擇

* 實作 `<PedelecStatusBadge/>` 與 `<PedelecInstallationGuideline/>`。


* 實作劇本討論聊天 UI，綁定 `setup_script` 工具，能讀取 AI 回傳的 `system_id` 切換 UI 風格主題。
* 實作「自訂房規設定區（House Rules Box）」。

### Task 3: 階段二（雙軌創角與檔案庫）

* 實作 CoC / D&D 雙軌創角介面（屬性分配器 + 劇情鉤子卡片）。
* 綁定 MathJS 解析器，輸入屬性時即時計算與顯示衍生 HP/MP/SAN/AC/Modifiers。
* 實作「匯入/匯出角色卡 (`.json`)」功能。

### Task 4: 階段三（遊戲主迴圈與萬用擲骰）

* 實作 **萬用擲骰彈窗**：支援 `1d100` 與 `1d20`（含 D&D 優勢/劣勢選鈕）。
* 實作 **GM 暗骰處理器** (`secret_check_request`) 與 **規則說明彈窗** (`lookup_rule`)。
* 實作側邊欄頁籤：`[角色卡]`、`[背包]`、`[線索/任務]`、`[NPC名冊]`。

### Task 5: 階段四（歷程回放與結算）

* 觸發 `end_game_session` 切換結局畫面，解鎖 `hidden_full_script` 真相。
* 根據 `system_id` 執行 CoC 技能成長檢定或 D&D 經驗值結算。
* 實作 `Timeline Scrubber` 時間軸拉桿，提供歷史 Snapshot 與暗骰數字對照。

---

## 🤖 附錄：交付給 Coding AI 的專屬指令檔 (`AGENTS_INSTRUCTIONS.md`)

請將以下內容存為專案根目錄下的 `AGENTS_INSTRUCTIONS.md`：

```markdown
# Instructions for AI Coding Agent: SessionZero Multi-System TRPG Engine

You are an expert Frontend Developer building "SessionZero", a universal AI TRPG Web App supporting both CoC 7th Edition and D&D 5e systems with a strict, non-hallucinating GM engine.

## 1. Primary Technology Architecture
- **Framework**: React + Vite 8
- **AI Agent Connectivity**: `@kaoruisaac/pedelec` (Pedelec Protocol)
- **UI Components**: Tailwind CSS + Shadcn/ui
- **State Management**: Zustand (with Snapshot & History State Machine)
- **Math Engine**: `mathjs`

## 2. Pedelec BYO-AI Integration Rules (Strict @kaoruisaac/pedelec Compliance)
1. Import SDK from `@kaoruisaac/pedelec` (e.g. `import { Pedelec, defineTool } from "@kaoruisaac/pedelec"`).
2. Integration Level is "Required Integration": Verify `pedelec.getApprovalStatus()` and `pedelec.listProviders()` before enabling gameplay UI.
3. Define tools using `defineTool` with `argsSchema` (JSON-compatible schema objects with `type: "object"`). Do NOT use Zod directly inside `defineTool`.
4. Register tools inside `pedelec.createSession({ skills: { tools: [...] } })`.

## 3. Strict GM Behavioral Directives (CRITICAL)
Enforce these prompt rules in system instructions given to the LLM:
- **Rule 1: No God-Moding**: The AI MUST NEVER narrate or decide the Player Character's (PC) actions, thoughts, or speech. Narration must pause as soon as player action is required.
- **Rule 2: Strict Outcome Permanence**: When a dice check fails or fumbles, the AI must deliver real negative consequences. Do NOT save the player artificially.
- **Rule 3: Information Barrier**: Never reveal `hidden_full_script` truth unless unlocked via successful skill checks.
- **Rule 4: Mandatory Tool Execution**: Any change in HP, SAN, or Inventory MUST trigger `update_game_stats`. Never change stats only in text.
- **Rule 5: House Rules & Hooks Compliance**: User-defined House Rules in the `[HOUSE RULES]` context ALWAYS override standard SRD rules. The AI MUST leverage backstory hooks in critical story turns.

## 4. 3-Tier Memory Architecture & Context Injection
Assemble every message sent to Pedelec Session in this structure:
1. **Top System Directives & Hidden Truth**: Unchanging system persona and script secrets.
2. **Middle Layer (House Rules, Chapter Summaries & Lorebook Keys)**: Custom House Rules, compressed past events (if turn > 10) plus keyword-triggered SRD/World Info.
3. **Sliding Window**: Last 8-10 raw dialogue rounds.
4. **Bottom Injection (SSOT Context)**: Appended at the VERY END of the prompt:
   ```text
   [CURRENT SSOT GAME STATE]
   - System: {system_id} | Location: {location}
   - Active House Rules: [{house_rules_summary}]
   - Player Stats: HP={hp}/{max_hp}, SAN={san}/{max_san}, AC={ac}
   - Backstory Hooks: [{hooks_summary}]
   - Inventory: [{inventory}] | Active Clues: [{clues}] | Madness: {madness_status}

```

## 5. The 11 Universal Pedelec Tools

Implement the 11 tools using `defineTool` from `@kaoruisaac/pedelec` and connect handlers directly to Zustand actions:

1. `setup_script`: Initializes game system_id ('COC_7E' | 'DND_5E'), public summary, & hidden truth.
2. `generate_character_schema`: Generates system-specific character rules, skill pools, and backstory hook questions.
3. `narrate_story`: Emits narrative & requests player-visible dice check (supports 1d100 and 1d20 with Advantage/Disadvantage).
4. `secret_check_request`: Performs silent background dice check for GM secret rolls without showing numbers to the player.
5. `update_game_stats`: Modifies HP/SAN/MP/SpellSlots/Inventory.
6. `mark_skill_success`: Flags successfully used skills for post-game growth.
7. `record_clue`: Adds discovered clues or quests to the Notebook tab.
8. `trigger_madness`: Triggers insanity/condition overlay.
9. `register_npc`: Updates NPC roster status & relationships.
10. `end_game_session`: Triggers ending UI & reveals hidden script truth.
11. `lookup_rule`: Cites SRD or House Rules justification for complex rule evaluations.

## 6. UI Guidelines

* Follow Pedelec component design guidelines for Status Badge and Installation Guideline UI components.
* Dynamic themes: Dark Lovecraftian for CoC 7e, Classic Fantasy Parchment for D&D 5e.
* Main Layout:
* Left Sidebar: Character Sheet, Stats Bars, Inventory, Clue Notebook, NPC Roster.
* Center: Story Log, Universal Dice Modal, Secret Roll Notice, Quick Action Presets, Input Area with Undo/Regenerate buttons.
* Header: Pedelec Status Badge (`<PedelecStatusBadge/>`).



```

```