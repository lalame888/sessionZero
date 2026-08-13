import type { CampaignPersist } from "@/lib/campaignStorage";

/**
 * 產生可離線開啟的靜態回放頁。
 * 會內嵌 session 資料（file:// 可用），並優先嘗試讀取同目錄的 json 檔。
 */
export function buildStaticReplayHtml(
  campaign: CampaignPersist,
  jsonFileName: string,
): string {
  const embedded = JSON.stringify(campaign).replace(/</g, "\\u003c");
  const title = escapeHtml(
    campaign.ending?.ending_title ||
      campaign.script.public_summary?.title ||
      campaign.title ||
      "SessionZero 回放",
  );

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · SessionZero 回放</title>
<style>
  :root {
    --bg: #14151a;
    --surface: #1c1e26;
    --surface-2: #252833;
    --border: #343849;
    --ink: #e8e6e1;
    --muted: #9aa3b5;
    --accent: #c4a574;
    --accent-2: #8fb4a0;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    background: radial-gradient(1200px 600px at 20% -10%, #2a2430 0%, var(--bg) 55%);
    color: var(--ink);
    min-height: 100vh;
    line-height: 1.55;
  }
  .wrap { max-width: 920px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 1.75rem; font-weight: 600; margin: 0 0 8px; letter-spacing: 0.02em; }
  .sub { color: var(--muted); font-size: 0.9rem; margin-bottom: 24px; }
  .panel {
    background: color-mix(in srgb, var(--surface) 85%, transparent);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .panel h2 {
    font-size: 0.95rem;
    margin: 0 0 12px;
    letter-spacing: 0.04em;
  }
  .meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.8rem; color: var(--muted); }
  .story { font-size: 0.95rem; white-space: pre-wrap; }
  .md p { margin: 0 0 0.75em; }
  .md h1, .md h2, .md h3 { margin: 1em 0 0.4em; font-size: 1.05em; }
  .md ul, .md ol { margin: 0.4em 0 0.8em; padding-left: 1.4em; }
  .md code { background: var(--surface-2); padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.9em; }
  .actor { margin-bottom: 12px; font-size: 0.9rem; }
  .actor .label { font-weight: 600; color: var(--muted); }
  .actor.companion .label { color: var(--accent); }
  .gm-label { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
  .dice {
    margin-top: 12px; padding: 8px 10px; border-radius: 6px;
    background: color-mix(in srgb, var(--bg) 50%, transparent); font-size: 0.8rem;
  }
  .scrub { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; }
  .scrub input[type=range] { flex: 1; min-width: 160px; }
  button {
    cursor: pointer; border: 1px solid var(--border); background: var(--surface-2);
    color: var(--ink); border-radius: 6px; padding: 6px 12px; font-size: 0.85rem;
  }
  button:hover { filter: brightness(1.08); }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  .truth { font-size: 0.88rem; color: var(--ink); }
  .truth .k { color: var(--accent-2); margin-top: 10px; font-size: 0.75rem; letter-spacing: 0.06em; }
  .err { color: #e88; padding: 24px; }
  .load-note { font-size: 0.75rem; color: var(--muted); margin-top: 8px; }
</style>
</head>
<body>
<div class="wrap" id="app">
  <p class="sub">正在載入回放資料…</p>
</div>
<script>
const EMBEDDED = ${embedded};
const JSON_FILE = ${JSON.stringify(jsonFileName)};

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mdToHtml(src) {
  let t = escapeHtml(src || "");
  t = t.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  t = t.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  t = t.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  t = t.replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>");
  t = t.replace(/\\*(.+?)\\*/g, "<em>$1</em>");
  t = t.replace(/\`([^\`]+)\`/g, "<code>$1</code>");
  t = t.replace(/^- (.+)$/gm, "<li>$1</li>");
  t = t.replace(/(?:<li>.*?<\\/li>\\s*)+/g, function (m) { return "<ul>" + m + "</ul>"; });
  t = t.replace(/\\n\\n+/g, "</p><p>");
  t = t.replace(/\\n/g, "<br/>");
  return "<p>" + t + "</p>";
}

function outcomeLabel(o) {
  const x = String(o || "").toUpperCase();
  const map = {
    CRITICAL_SUCCESS: "大成功", CRITICAL: "大成功",
    EXTREME_SUCCESS: "極限級成功", EXTREME: "極限級成功",
    HARD_SUCCESS: "困難級成功", HARD: "困難級成功",
    SUCCESS: "普通成功", REGULAR_SUCCESS: "普通成功",
    FAILURE: "失敗", FUMBLE: "大失敗", CRITICAL_FAILURE: "大失敗",
  };
  return map[x] || o || "—";
}

function parseActor(input) {
  const raw = String(input || "").trim();
  const m = raw.match(/^【隊友[·・]([^】]+)】(.*)$/s);
  if (m) {
    return { kind: "companion", label: "隊友 · " + (m[1] || "").trim(), body: (m[2] || "").trimStart() || raw };
  }
  return { kind: "player", label: "玩家", body: raw };
}

async function loadCampaign() {
  try {
    const res = await fetch(JSON_FILE, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      return { data: data.campaign || data, source: JSON_FILE };
    }
  } catch (_) {}
  return { data: EMBEDDED, source: "embedded" };
}

function render(campaign, source) {
  const app = document.getElementById("app");
  const history = Array.isArray(campaign.history) ? campaign.history : [];
  const ending = campaign.ending || null;
  const hidden = campaign.script && campaign.script.hidden_full_script;
  const title =
    (ending && ending.ending_title) ||
    (campaign.script && campaign.script.public_summary && campaign.script.public_summary.title) ||
    campaign.title ||
    "SessionZero 回放";

  let idx = Math.max(0, history.length - 1);

  let truthHtml = "";
  if (hidden) {
    const bits = [];
    if (hidden.truth_and_secrets) {
      bits.push('<div class="k">真相與秘密</div><div class="truth">' + escapeHtml(hidden.truth_and_secrets) + "</div>");
    }
    if (hidden.winning_condition) {
      bits.push('<div class="k">勝利條件</div><div class="truth">' + escapeHtml(hidden.winning_condition) + "</div>");
    }
    if (Array.isArray(hidden.key_clues) && hidden.key_clues.length) {
      bits.push(
        '<div class="k">關鍵線索</div><ul>' +
          hidden.key_clues.map((c) => "<li>" + escapeHtml(c) + "</li>").join("") +
          "</ul>",
      );
    }
    if (bits.length) {
      truthHtml =
        '<section class="panel"><h2>上帝視角</h2>' + bits.join("") + "</section>";
    }
  }

  const endingHtml = ending
    ? '<section class="panel"><h2>結局</h2>' +
      (ending.ending_title
        ? "<div style=\\"font-weight:600;margin-bottom:8px\\">" +
          escapeHtml(ending.ending_title) +
          "</div>"
        : "") +
      (ending.ending_narrative
        ? '<div class="md story">' + mdToHtml(ending.ending_narrative) + "</div>"
        : "") +
      "</section>"
    : "";

  let scrubShell = '<section class="panel"><h2>時間軸回放</h2>';
  if (!history.length) {
    scrubShell += '<p class="sub">尚無歷史快照。</p></section>';
  } else {
    scrubShell +=
      '<div class="scrub">' +
      '<button type="button" id="prev">上一則</button>' +
      '<input type="range" id="range" min="0" max="' +
      (history.length - 1) +
      '" value="' +
      idx +
      '" step="1" />' +
      '<button type="button" id="next">下一則</button>' +
      "</div>" +
      '<div class="meta" id="entry-meta"></div>' +
      '<div id="entry-body" style="margin-top:12px;max-height:320px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:12px;background:color-mix(in srgb, var(--bg) 40%, transparent)"></div>' +
      "</section>";
  }

  app.innerHTML =
    "<h1>" +
    escapeHtml(title) +
    "</h1>" +
    '<p class="sub">SessionZero 靜態回放 · 資料來源：' +
    escapeHtml(source) +
    "</p>" +
    endingHtml +
    truthHtml +
    scrubShell +
    '<p class="load-note">同目錄另附 ' +
    escapeHtml(JSON_FILE) +
    "，可於 SessionZero 首頁匯入劇本或保留存檔。</p>";

  if (!history.length) return;

  const range = document.getElementById("range");
  const prev = document.getElementById("prev");
  const next = document.getElementById("next");
  const metaEl = document.getElementById("entry-meta");
  const bodyEl = document.getElementById("entry-body");

  function paintEntry() {
    const entry = history[idx];
    if (!entry || !metaEl || !bodyEl) return;
    const char = entry.snapshot && entry.snapshot.character;
    const actor = entry.playerInput && entry.playerInput.trim()
      ? parseActor(entry.playerInput)
      : null;

    metaEl.innerHTML =
      "<span>Turn " +
      escapeHtml(entry.turn) +
      " · " +
      escapeHtml(new Date(entry.timestamp).toLocaleString()) +
      "</span>" +
      (char
        ? "<span>" +
          escapeHtml((char.name && char.name.trim()) || "（未命名）") +
          (char.role_title ? " · " + escapeHtml(char.role_title) : "") +
          "</span><span>HP " +
          escapeHtml(char.derived && char.derived.hp
            ? char.derived.hp.current + "/" + char.derived.hp.max
            : "—") +
          "</span>" +
          (char.derived && char.derived.san
            ? "<span>SAN " +
              escapeHtml(char.derived.san.current + "/" + char.derived.san.max) +
              "</span>"
            : "") +
          "<span>線索 " +
          escapeHtml(
            (entry.snapshot.clues && entry.snapshot.clues.length) || 0,
          ) +
          "</span><span>NPC " +
          escapeHtml(
            (entry.snapshot.npcs && entry.snapshot.npcs.length) || 0,
          ) +
          "</span>"
        : "");

    bodyEl.innerHTML =
      (actor
        ? '<div class="actor ' +
          actor.kind +
          '"><span class="label">' +
          escapeHtml(actor.label) +
          "：</span>" +
          escapeHtml(actor.body) +
          "</div>"
        : "") +
      (entry.aiNarrative && String(entry.aiNarrative).trim()
        ? '<div class="gm-label">GM</div><div class="md story">' +
          mdToHtml(entry.aiNarrative) +
          "</div>"
        : "") +
      (entry.diceRecord
        ? '<div class="dice"><div>骰子：' +
          escapeHtml(entry.diceRecord.skillName) +
          (entry.diceRecord.isSecret ? "（原暗骰）" : "") +
          "</div><div>" +
          escapeHtml(entry.diceRecord.diceType) +
          " → " +
          escapeHtml(entry.diceRecord.diceResult) +
          "（" +
          escapeHtml(outcomeLabel(entry.diceRecord.outcome)) +
          "）" +
          (entry.diceRecord.targetValue != null
            ? " / 門檻 " + escapeHtml(entry.diceRecord.targetValue)
            : "") +
          "</div></div>"
        : "");

    if (range && Number(range.value) !== idx) range.value = String(idx);
    if (prev) prev.disabled = idx <= 0;
    if (next) next.disabled = idx >= history.length - 1;
  }

  function setIdx(nextIdx) {
    idx = Math.max(0, Math.min(history.length - 1, nextIdx));
    paintEntry();
  }

  // 滑桿本體不銷毀／重建，才能連續拖曳
  range.addEventListener("input", (e) => {
    setIdx(Number(e.target.value));
  });
  prev.addEventListener("click", () => setIdx(idx - 1));
  next.addEventListener("click", () => setIdx(idx + 1));

  paintEntry();
}

loadCampaign()
  .then(({ data, source }) => render(data, source))
  .catch((err) => {
    document.getElementById("app").innerHTML =
      '<p class="err">載入失敗：' + escapeHtml(err && err.message) + "</p>";
  });
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
