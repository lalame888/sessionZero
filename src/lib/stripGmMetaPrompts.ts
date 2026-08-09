/** GM 敘事中常見的破第四牆／UI 提示（應移除，勿顯示給玩家） */
const TRAILING_META_RE =
  /\n*[（(][^）)]*(?:請輸入|下一步行動|輸入框|請描述您的|請於輸入|等待玩家|等待您的)[^）)]*[）)]\s*$/s;

const META_ONLY_RE =
  /^[（(][^）)]*(?:請輸入|下一步行動|輸入框|故事已正式開始|等待玩家)[^）)]*[）)]\s*$/s;

/** Companion pipeline / GM 內部等待狀態（整段應隱藏） */
const COMPANION_WAIT_META_RE =
  /Waiting for companion action response\.|I will wait for the companion(?:'s)? response|No more tools to call\.?(?:\s*Waiting for [^\n]*)?|Waiting for the transition to the carousel(?: and companion action)?\.?|Waiting for the (?:background task|companion response task) to complete[^\n]*|等待隊友行動|呼叫隊友.{0,40}(?:配合|前來|協助|回應)/i;

/** 是否為隊友 pipeline 的內部等待／轉場腔（勿當劇情顯示、勿觸發自動喚起） */
export function isCompanionWaitMeta(text: string): boolean {
  return COMPANION_WAIT_META_RE.test(text.trim());
}

/**
 * Pedelec／Agent 把背景任務、檢定排隊狀態寫進玩家可見氣泡（應整段或整句剝除）
 * 例：task-50 號背景任務已 launched…系統將在擲骰結果返回後自動通知…
 */
const PIPELINE_STATUS_META_RE =
  /task-\d+\s*號?\s*背景任務[^\n]*|背景任務已\s*(?:launched|啟動|啟動喚起|發起)[^\n]*|已為您發起[^\n]*(?:檢定請求|應對反應任務|任務)[^\n]*|系統將在[^\n]*(?:自動通知|自動銜接|推進劇情|擲骰結果返回)[^\n]*|正在處理隊友[^\n]*檢定行動[^\n]*|現場敘事已推進至[^\n]*|場景已設置完畢[^\n]*|等待主角發起下一步[^\n]*|等待隊友與主角的下一步[^\n]*/gi;

const ITALIC_PIPELINE_META_RE =
  /\*+\s*[（(]?已為您發起[^*)\n]*(?:任務|檢定)[^*)\n]*[)）]?\s*\*+/gi;

const COMPANION_TAG_LINE_RE = /^【隊友[·・][^\n]*/;

/** 隊友結算／bible 欄位誤寫進玩家氣泡 */
const BIBLE_META_INLINE_RE =
  /\bkey_clue\b\s*[:：]?\s*/gi;

/** GM 未真擲骰卻自寫的檢定結果標題腔（含【隊友檢定結果】／【檢定結果：敏捷…】） */
const COMPANION_CHECK_RESULT_HEADER_RE =
  /【\s*(?:隊友)?檢定結果[：:][^】]*】\s*/g;

/**
 * 移除 GM 誤把隊友發言貼進敘事的開頭（【隊友·名】…）。
 * 隊友宣告已有獨立氣泡，GM 不應再複讀。
 */
export function stripCompanionEchoFromGmNarrative(text: string): string {
  if (!text?.trim()) return text;
  let t = text.trim();
  // 連續剝離開頭的【隊友·…】行／段
  for (let n = 0; n < 8; n++) {
    if (!COMPANION_TAG_LINE_RE.test(t)) break;
    const nl = t.indexOf("\n");
    if (nl < 0) {
      t = "";
      break;
    }
    t = t.slice(nl + 1).replace(/^\s*\n+/, "").trim();
  }
  return t;
}

/**
 * 隊友結算時：若開頭段落以隊友姓名第三人稱重述其宣告，剝掉該段，保留世界反應／檢定結果。
 */
export function stripLeadingCompanionParaphrase(
  text: string,
  companionName: string,
): string {
  const name = companionName.trim();
  if (!text?.trim() || !name) return text;
  const nameEsc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameLead = new RegExp(
    `^(?:【隊友[·・][^】]*】)?\\s*${nameEsc}(?:大喊|急忙|忍痛|咬牙|立刻|快步|轉頭|一邊|伸手|抓住|扶住|衝到|喊道|說道)?`,
  );

  const paras = text.split(/\n\n+/);
  let i = 0;
  while (i < paras.length) {
    const p = (paras[i] ?? "").trim();
    if (!p) {
      i++;
      continue;
    }
    if (COMPANION_TAG_LINE_RE.test(p)) {
      i++;
      continue;
    }
    // 短／中段、以隊友名開場、且不像檢定結果 → 視為複述
    if (
      p.length <= 480 &&
      nameLead.test(p) &&
      !/【檢定結果/.test(p)
    ) {
      i++;
      continue;
    }
    break;
  }
  return paras.slice(i).join("\n\n").trim();
}

function stripPipelineStatusMeta(text: string): string {
  let t = text;
  t = t.replace(ITALIC_PIPELINE_META_RE, "");
  t = t.replace(PIPELINE_STATUS_META_RE, "");
  // 逐行再清一次殘句（含英文 launched／task-）
  t = t
    .split("\n")
    .filter((line) => {
      const L = line.trim();
      if (!L) return true;
      if (/^task-\d+/i.test(L)) return false;
      if (/背景任務已/i.test(L)) return false;
      if (/系統將在/.test(L) && /(?:自動|擲骰|推進)/.test(L)) return false;
      if (/已為您發起/.test(L)) return false;
      if (/^\*?等待(?:隊友|主角)/.test(L)) return false;
      if (/^No more tools to call/i.test(L)) return false;
      if (/^Waiting for the transition to the carousel/i.test(L)) return false;
      if (/^Waiting for the (?:background task|companion response task)/i.test(L))
        return false;
      if (/現場敘事已推進/.test(L)) return false;
      if (/場景已設置完畢/.test(L)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t;
}

/** 整段是否幾乎都是 pipeline／系統狀態腔（無真正劇情） */
function isMostlyPipelineStatus(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^task-\d+/i.test(t) && /背景任務|launched|啟動/.test(t)) return true;
  if (/已為您發起/.test(t) && /系統將在/.test(t)) return true;
  const withoutMeta = stripPipelineStatusMeta(t);
  // 剝完後幾乎沒字，或只剩「等待…」類空話
  if (!withoutMeta) return true;
  if (withoutMeta.length < 24 && /等待|設置完畢|推進/.test(withoutMeta)) {
    return true;
  }
  // 原文很短且含多重系統詞
  const hits = [
    /task-\d+/i,
    /背景任務/,
    /已為您發起/,
    /系統將在/,
    /launched/i,
  ].filter((re) => re.test(t)).length;
  if (hits >= 2 && withoutMeta.length < t.length * 0.35) return true;
  return false;
}

/**
 * 移除 narrate_story 末尾或整段純 UI 提示。
 * 若整段只剩提示，回傳空字串（呼叫端應略過顯示）。
 */
export function stripGmMetaPrompts(text: string): string {
  if (!text?.trim()) return text;
  let t = text.trim();

  if (isMostlyPipelineStatus(t)) return "";

  // Pedelec/companion pipeline 內部等待狀態（不該顯示給玩家）
  if (COMPANION_WAIT_META_RE.test(t)) {
    // 整段幾乎都是等待 meta → 隱藏；若夾雜真正敘事則只剝等待句
    const withoutWait = t
      .replace(/^---+\s*/gm, "")
      .replace(/^\*?等待隊友行動[^*]*\*?\s*$/gim, "")
      .replace(/^I will wait for the companion[^\n]*$/gim, "")
      .replace(/^Waiting for companion[^\n]*$/gim, "")
      .replace(/^No more tools to call[^\n]*$/gim, "")
      .replace(/^Waiting for the transition to the carousel[^\n]*$/gim, "")
      .replace(/^Waiting for the (?:background task|companion response task)[^\n]*$/gim, "")
      .replace(/^呼叫隊友[^\n]*$/gim, "")
      .trim();
    if (!withoutWait || COMPANION_WAIT_META_RE.test(withoutWait)) return "";
    t = withoutWait;
  }

  t = stripPipelineStatusMeta(t);
  if (!t.trim()) return "";

  // bible／pipeline 欄位名（key_clue）與「【隊友檢定結果】」標題腔
  t = t.replace(BIBLE_META_INLINE_RE, "");
  t = t.replace(COMPANION_CHECK_RESULT_HEADER_RE, "");
  t = t.replace(/【\s*key_clue\s*[：:]?\s*/gi, "【");
  t = t.replace(/\*\*?\s*key_clue\s*\*\*?/gi, "");

  t = stripCompanionEchoFromGmNarrative(t);
  if (META_ONLY_RE.test(t)) return "";
  t = t.replace(TRAILING_META_RE, "").trim();
  if (META_ONLY_RE.test(t)) return "";
  return t;
}

export function isGmMetaOnlyNarrative(text: string): boolean {
  return !stripGmMetaPrompts(text).trim();
}

/** 隊友宣告是否偏「純發言／分工提議」（可不經 GM 複述） */
export function isCompanionSpeechOnly(action: string): boolean {
  const t = action.trim();
  if (!t) return true;
  const withoutQuotes = t
    .replace(/「[^」]*」/g, " ")
    .replace(/『[^』]*』/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/（[^）]*）/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!withoutQuotes || withoutQuotes.length < 10) return true;

  const attemptRe =
    /我(?:試圖|打算|用力|衝|打|砸|射|砍|推|拉|撬|跑|爬|攀|閃|擋|扔|投|抓|抱|扶|拖|踢|刺|噴|點燃|急救|包紮|檢查|搜索|偵查)|試圖|奮力|拼命|立刻|出手|攻擊|格擋|掩護射擊/;
  if (attemptRe.test(t)) return false;
  return withoutQuotes.length < 48;
}
