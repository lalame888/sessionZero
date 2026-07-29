# SessionZero

萬用 AI TRPG 跑團引擎，取名自經典術語 **Session 0**——開團前討論劇本、系統與創角的階段。

支援 **《克蘇魯的呼喚》第七版（CoC 7e）** 與 **D&D 5e**，透過 [`@kaoruisaac/pedelec`](https://www.npmjs.com/package/@kaoruisaac/pedelec) 以 **BYO-AI**（自備本機 Agent）連線，無需後端代管 API Key。

## 特色

- **前端為 SSOT**：HP / SAN / MP、屬性、技能、線索與歷史快照由 Zustand 控管，避免 LLM 數值幻覺
- **雙軌創角**：數值（擲骰／標準陣列／購點／技能雙點池）+ 劇情鉤子（Backstory Hooks）
- **Session 0 流程**：劇本討論 → 房規 → 創角藍圖 → 配點創角 → 進入冒險
- **嚴格 GM 契約**：禁止代控 PC、失敗必有代價、隱藏真相不洩漏、數值異動必須走 Tool
- **房規優先**：自訂房規覆寫 SRD；可搭配本地 SRD lorebook 檢索

## 前置需求

1. Node.js 20+（建議）
2. [Pedelec Desktop](https://pedelec.cc/download)
3. [Pedelec Chrome Extension](https://chromewebstore.google.com/detail/pedelec/ogccgaminlphbkeghldidiiimajfdpag)
4. 本機已設定可用的 LLM Provider（OpenAI / Anthropic / Ollama 等，依 Pedelec 支援為準）

## 快速開始

```bash
npm install
npm run dev
```

瀏覽器開啟 Vite 顯示的本機網址後：

1. 確認 Pedelec 狀態為已連線／已核准
2. 在「劇情討論」描述想玩的氛圍，或一鍵請 AI 生成 CoC 劇本
3. 確認創角藍圖與房規 → 進入創角配點 → 開始冒險

### 其他指令

```bash
npm run build    # TypeScript 檢查 + 正式建置
npm run preview  # 預覽建置結果
npm run lint     # oxlint
```

## 遊戲階段

| 階段 | 說明 |
|------|------|
| Preflight | Pedelec 預檢與安裝引導 |
| Session 0 | 劇本公開摘要、房規、創角藍圖 |
| Character | 依藍圖擲骰／配點／填寫劇情鉤子 |
| Playing | 敘事推進、檢定、狀態與線索更新 |
| Ending | 結局與隱藏真相揭曉 |

## 技術棧

| 項目 | 技術 |
|------|------|
| 框架 | React 19 + Vite 8 + TypeScript |
| 樣式 | Tailwind CSS 4 |
| 狀態 | Zustand |
| 公式 | mathjs |
| AI | `@kaoruisaac/pedelec` + Tool Calling |
| UI | Radix UI primitives |

## 專案結構（精簡）

```
src/
  components/   # 頁面、創角、聊天、Pedelec UI
  engine/       # 擲骰、創角規則、衍生數值、Context 組裝
  lib/pedelec/  # Session 建立與 Tool handlers
  prompts/      # GM system directives
  store/        # Zustand SSOT
  tools/        # Pedelec tool definitions
  types/        # 遊戲型別
doc/            # 規格書
```

## 文件

- [`AGENTS_INSTRUCTIONS.md`](./AGENTS_INSTRUCTIONS.md) — 給 AI coding agent 的實作規範
- [`doc/doc.md`](./doc/doc.md) — 完整產品／引擎規格書

## 授權

目前為私人／實驗專案；若之後要開源再補上授權條款。
