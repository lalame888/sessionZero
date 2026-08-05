/**
 * 偵測／解析模型誤把 Pedelec tool call 寫成 chat 文字的洩漏格式，例如：
 * {"command":"pedelec-cli tool-call narrate_story '{...}'","timeoutMs":180000}
 */

export type LeakedToolCall = {
  tool: string;
  args: unknown;
};

const CLI_HINT =
  /pedelec-cli\s+tool-call|"command"\s*:\s*"pedelec-cli|^\s*\{\s*"command"/i;

/** 內容是否像洩漏的 tool-call（含串流未完成片段） */
export function looksLikeLeakedToolCall(text: string): boolean {
  return CLI_HINT.test(text.trim());
}

/**
 * 嘗試從完整（或接近完整）文字解析出 tool + args。
 * 未完成或無法解析時回傳 null。
 */
export function tryParseLeakedToolCall(text: string): LeakedToolCall | null {
  const trimmed = stripCodeFence(text.trim());
  if (!trimmed || !looksLikeLeakedToolCall(trimmed)) return null;

  const fromJson = tryParseCommandJson(trimmed);
  if (fromJson) return fromJson;

  const fromCli = tryParseCliCommand(trimmed);
  if (fromCli) return fromCli;

  // 文字中夾帶 command JSON
  const embedded = extractBalancedJsonObject(trimmed);
  if (embedded) {
    const inner = tryParseCommandJson(embedded);
    if (inner) return inner;
  }

  return null;
}

/** 外層 JSON 已完整但無法還原成 tool call（用來決定要丟棄並提示） */
export function isCompleteLeakedPayload(text: string): boolean {
  const trimmed = stripCodeFence(text.trim());
  if (!looksLikeLeakedToolCall(trimmed)) return false;
  if (tryParseLeakedToolCall(trimmed)) return true;

  if (trimmed.startsWith("{")) {
    const obj = extractBalancedJsonObject(trimmed);
    if (obj && obj.length === trimmed.length) {
      try {
        JSON.parse(obj);
        return true;
      } catch {
        return false;
      }
    }
  }

  // 純 CLI 字串：引號成對且以 } 或 ' 結尾
  if (/^pedelec-cli\s+tool-call\s+\S+\s+/i.test(trimmed)) {
    const quote = trimmed.includes("'{" ) ? "'" : trimmed.includes('"{') ? '"' : null;
    if (!quote) return /\{[\s\S]*\}\s*$/.test(trimmed);
    return trimmed.endsWith(quote) && trimmed.indexOf(quote) !== trimmed.lastIndexOf(quote);
  }

  return false;
}

function stripCodeFence(text: string): string {
  const m = text.match(/^```(?:json|text|shell)?\s*([\s\S]*?)```$/i);
  return m?.[1]?.trim() ?? text;
}

function tryParseCommandJson(text: string): LeakedToolCall | null {
  let parsed: unknown;
  try {
    const candidate = extractBalancedJsonObject(text) ?? text;
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const command = (parsed as { command?: unknown }).command;
  if (typeof command !== "string") return null;
  return tryParseCliCommand(command);
}

function tryParseCliCommand(command: string): LeakedToolCall | null {
  const m = command
    .trim()
    .match(/^pedelec-cli\s+tool-call\s+(\S+)\s+([\s\S]+)$/i);
  if (!m?.[1] || m[2] == null) return null;

  const tool = m[1];
  let rawArgs = m[2].trim();
  if (
    (rawArgs.startsWith("'") && rawArgs.endsWith("'")) ||
    (rawArgs.startsWith('"') && rawArgs.endsWith('"'))
  ) {
    rawArgs = rawArgs.slice(1, -1);
  }

  try {
    return { tool, args: JSON.parse(rawArgs) };
  } catch {
    return null;
  }
}

/** 取出第一個括號平衡的 `{...}`（字串內的括號不算） */
function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
