import type { CampaignPersist } from "@/lib/campaignStorage";
import { createEmptyCampaignPersist } from "@/lib/campaignStorage";
import { downloadBlob, downloadJson, safeFilename } from "@/lib/downloadBlob";
import { buildStaticReplayHtml } from "@/lib/staticReplayHtml";
import { createZipBlob } from "@/lib/zipStore";

export const SCRIPT_PACK_FORMAT = "sessionzero.script-pack-v1" as const;
export const SESSION_PACK_FORMAT = "sessionzero.session-pack-v1" as const;

export type ScriptPack = {
  format: typeof SCRIPT_PACK_FORMAT;
  exportedAt: number;
  /** 創角前狀態：劇本、隱藏資訊、創角藍圖等 */
  campaign: CampaignPersist;
};

export type SessionPack = {
  format: typeof SESSION_PACK_FORMAT;
  exportedAt: number;
  campaign: CampaignPersist;
};

const blankMadness = { active: false as const };

/**
 * 將任意战役存檔收斂成「劇本已就緒、尚未創角」狀態。
 * 保留 script / characterSchema / houseRules / 討論訊息與人數設定。
 */
export function toPreCharacterCampaign(
  source: CampaignPersist,
  opts?: { newId?: boolean },
): CampaignPersist {
  const reuseId = opts?.newId === false;
  const base = createEmptyCampaignPersist();
  const now = Date.now();
  const title =
    source.script?.public_summary?.title?.trim() ||
    source.title ||
    base.title;

  return {
    ...base,
    id: reuseId ? source.id : base.id,
    title,
    createdAt: reuseId ? source.createdAt : now,
    updatedAt: now,
    phase: "SESSION_0",
    theme: source.theme ?? base.theme,
    location: source.location || base.location,
    sceneDirector: source.sceneDirector ?? base.sceneDirector,
    script: {
      ...source.script,
      revealed: false,
    },
    houseRules: source.houseRules ?? base.houseRules,
    character: null,
    characterSchema: source.characterSchema ?? null,
    characterBaseline: null,
    boundCharacterId: null,
    clues: [],
    playerNotes: [],
    npcs: [],
    madness: blankMadness,
    history: [],
    chapterSummaries: [],
    turn: 0,
    // 僅保留尚未進入冒險的討論；已完結場次匯入時不帶遊玩對話
    messages:
      source.phase === "SESSION_0" ||
      source.phase === "PREFLIGHT" ||
      source.phase === "CHARACTER"
        ? (source.messages ?? []).filter(
            (m) =>
              m.role === "user" || m.role === "agent" || m.role === "system",
          )
        : [],
    ending: null,
    timelineIndex: null,
    lastPlayerAction: "",
    composerDraft: "",
    suggestPlayerActions: source.suggestPlayerActions ?? true,
    endingCharacterSettled: false,
    endingSettlement: null,
    partySize: source.partySize ?? source.script?.recommended_party_size ?? 1,
    recommendedPartySize:
      source.recommendedPartySize ??
      source.script?.recommended_party_size ??
      null,
    party: [],
    playerMemberId: null,
    editingPartySlotIndex: 0,
    endingCompanionsSavedIds: [],
    endingCompanionsResolved: false,
    pendingCompanionHandoff: null,
    continuityBridge: null,
    viewedPartyMemberId: null,
  };
}

export function buildScriptPack(source: CampaignPersist): ScriptPack {
  return {
    format: SCRIPT_PACK_FORMAT,
    exportedAt: Date.now(),
    campaign: toPreCharacterCampaign(source, { newId: false }),
  };
}

export function canExportScriptPack(data: CampaignPersist): boolean {
  return Boolean(data.script?.public_summary);
}

export function exportScriptPackDownload(source: CampaignPersist) {
  const pack = buildScriptPack(source);
  const name = safeFilename(
    pack.campaign.script.public_summary?.title || pack.campaign.title,
    "script",
  );
  downloadJson(pack, `${name}-script-pack.json`);
}

export function buildSessionPack(source: CampaignPersist): SessionPack {
  return {
    format: SESSION_PACK_FORMAT,
    exportedAt: Date.now(),
    campaign: source,
  };
}

export function exportSessionZipDownload(source: CampaignPersist) {
  const pack = buildSessionPack(source);
  const stem = safeFilename(
    source.ending?.ending_title ||
      source.script.public_summary?.title ||
      source.title,
    "session",
  );
  const jsonName = `${stem}.json`;
  const jsonText = JSON.stringify(pack, null, 2);
  const html = buildStaticReplayHtml(source, jsonName);
  const zip = createZipBlob([
    { name: jsonName, content: jsonText },
    { name: "index.html", content: html },
  ]);
  downloadBlob(zip, `${stem}-replay.zip`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function extractCampaign(raw: unknown): CampaignPersist | null {
  if (!isRecord(raw)) return null;

  // wrapper: { format, campaign }
  if (isRecord(raw.campaign) && "script" in raw.campaign) {
    return raw.campaign as unknown as CampaignPersist;
  }

  // raw CampaignPersist
  if ("script" in raw && "phase" in raw) {
    return raw as unknown as CampaignPersist;
  }

  return null;
}

export type ParseScriptImportResult =
  | { ok: true; campaign: CampaignPersist }
  | { ok: false; message: string };

/**
 * 解析匯入的劇本包 JSON，產出新 id、phase=SESSION_0 的创角前存檔。
 */
export function parseScriptPackImport(raw: unknown): ParseScriptImportResult {
  const campaign = extractCampaign(raw);
  if (!campaign) {
    return {
      ok: false,
      message: "無法辨識的 JSON：需要 SessionZero 劇本包或戰役存檔。",
    };
  }
  if (!campaign.script?.public_summary) {
    return {
      ok: false,
      message: "此檔案尚未包含已生成的劇本公開摘要，無法匯入。",
    };
  }
  return {
    ok: true,
    campaign: toPreCharacterCampaign(campaign, { newId: true }),
  };
}

export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text) as unknown;
}
