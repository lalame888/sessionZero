# GM 記憶與 Token 策略

SessionZero 透過 Pedelec／Antigravity 跑 GM。實測（例如 `logs/t00000f`）顯示：

- 每次 `sendText` 若帶 `--conversation <id>` **接續同一條對話**，provider 會累積所有歷史 prompt、tool 往返與 assistant 訊息。
- 若 SessionZero **每回合又重塞** `RECENT DIALOGUE`／完整 SSOT／canon，會形成**雙重記憶**，累計 `input_tokens` 可在約 10 拍內從 ~27 萬漲到 ~92 萬。

本文件描述現行「短增量 + 查詢 tools + 週期壓縮」設計。

---

## 三層職責

| 層 | 內容 | 頻率 |
|----|------|------|
| **Guidance**（`GM_SESSION_GUIDANCE`） | 極短身份 + 指向 sandbox 規範檔／lookup | `createSession` 一次（進 `-p`） |
| **Sandbox 規範**（`/gm_standing_rules.md`） | 完整站立規則、tool 路由表 | 每 session `uploadAsset` 一次；agent 按需讀 |
| **Turn prompt** | `seed` 或 `delta`（見下） | 每次 `sendGmText`／`sendPlayerAction` |
| **Store + bible** | 遊戲 SSOT、章節摘要、`/scenario_bible.md` | 常駐；用 tools 按需讀取 |

真相來源永遠是 **前端 store／sandbox 資產**，不是 provider conversation。

`lookup_game_state` 會附帶 **Available tools**（依 Session 0／PLAYING 實際掛載清單），因此 guidance 不必再寫一長串「禁止呼叫某某 tool」。

---

## Prompt 模式

實作：`src/engine/contextAssembler.ts`、`src/engine/gmMemoryPolicy.ts`

### `seed`（新 conversation 或剛 compact 後）

塞入可開工的最小工作記憶：

- 公開梗概、短 canon、房規、章節摘要 rollup
- 瘦 SSOT（技能 top-N 等）
- 至多 4 則短近對話
- 本回合 `[User Action]`

標頭含 `[MEMORY MODE: SEED]`。

### `delta`（同一 conversation 續聊）

**不再重播**近對話／完整 canon／大段摘要，只送：

- `[MEMORY MODE: DELTA]` + lookup 提示
- `[STATE DELTA]`（地點、HP/SAN、線索標題、scene_id…）
- 必要的 incapacitated／check economy／companion 指令
- `[User Action]`

細節改呼叫 tools。

---

## 查詢 Tools

| Tool | 用途 |
|------|------|
| `lookup_scenario_term` | 劇本專有名詞／core（truth、win、acts…） |
| `lookup_game_state` | 當下 SSOT 短快照 + **Available tools** |
| `lookup_history` | 章節摘要與／或近期對話（截斷） |
| `lookup_rule` | SRD／房規 |
| `lookup_prior_script_design` | Session 0：按需取既有劇本壓縮摘要 |

Sandbox 檔：

| 路徑 | 用途 |
|------|------|
| `/gm_standing_rules.md` | 完整 GM 站立規範（createSession 上傳） |
| `/scenario_bible.md` | 劇本 hidden bible（setup 後同步） |

Guidance／SEED 要求：不確定就查或讀檔；**禁止**把 GM-only 原文倒給玩家。

格式化：`src/engine/gmMemoryLookup.ts`。

---

## Conversation 壓縮（compact）

常數：`PROVIDER_COMPACT_EVERY = 5`（`gmMemoryPolicy.ts`）

流程（`createGameSession.ts`）：

1. 計算自上次 create／compact 起的 `providerSendCount`。
2. 當 `count > 0` 且 `count % 5 === 0`，下一則送出前：
   - `createGameSession(lastCreateOptions)` → **新的 provider conversation**（遊戲 store 不變）
   - PLAYING／ENDING 只掛精簡 tools（不含 `setup_script` 等 Session 0 工具）
   - 重新 upload bible、重掛 tools
   - 系統訊息提示「記憶已壓縮」
3. 該則改組 **`seed`** prompt，再 `sendText`。
4. 進入 PLAYING 第一次（開場）若仍掛 Session 0 tools，會先換精簡清單（等同一次重建，下一則 SEED）。
5. 開場 `sendOpeningNarration` 依 `peekGmPromptMode()`：已在同一 conversation 則走 **delta**，不必重塞完整 SEED。

主 GM 路徑應走：

- `sendPlayerAction`／`sendOpeningNarration`（內部計數）
- 或匯出的 **`sendGmText`**（ScriptPage 藍圖、CharacterStage 敘事、漏 tool 還原等）

獨立 session（AI 隊友、AI 玩家、結局 synopsis）**不要**用 `sendGmText`。

---

## 為什麼這樣能省 token 又不失真

1. **Resume 不再重播歷史** → 去掉雙重記憶裡「我們重塞」的那一層。  
2. **定期新 conversation** → 截斷 provider 端線性膨脹（對照 t00000f 曲線）。  
3. **Tools 隨時可查** → 壓縮後仍能對齊 store／bible，避免靠模型「背」長對話。  
4. **SEED 仍帶短 canon + 摘要** → 壓縮當下不至於失憶開場。

---

## 調參

| 常數 | 位置 | 說明 |
|------|------|------|
| `PROVIDER_COMPACT_EVERY` | `gmMemoryPolicy.ts` | 越小越省長 conversation、重建越頻繁（現行 5） |
| `SIDE_SESSION_REUSE_EVERY` | `gmMemoryPolicy.ts` | 隊友／AI 玩家續聊幾次後重建（現行 4） |
| `SEED_DIALOGUE_MAX_MSGS` | `contextAssembler.ts` | seed 近對話則數 |
| `CHAPTER_RECENT_KEEP` / `CHAPTER_ROLLUP_MAX` | `contextAssembler.ts` | 章節摘要進 prompt 的量 |
| `DIALOGUE_LINE_MAX` | `contextAssembler.ts` | 單則對話截斷 |

---

## 觀測建議

看 sandbox `logs/events.jsonl`：

- `provider_command_started` 的 `prompt` 長度：delta 應明顯短於舊版全量。  
- 是否出現新的 `conversation_id`（compact 後）。  
- `result.usage.input_tokens` 是否仍隨回合單調暴漲（壓縮後曲線應呈鋸齒狀重置）。

---

## 相關檔案

- `src/prompts/gmDirectives.ts` — 短 guidance + `GM_STANDING_RULES_MARKDOWN`  
- `src/engine/contextAssembler.ts` — seed／delta 組裝  
- `src/engine/gmMemoryLookup.ts` — state／history 查詢字串（含 Available tools）  
- `src/engine/gmMemoryPolicy.ts` — 政策常數  
- `src/lib/pedelec/createGameSession.ts` — compact、`sendGmText`、tool handlers  
- `src/tools/definitions.ts` — tool schema  
- `src/lib/pedelec/sessionAssets.ts` — bible + standing rules 資產  
