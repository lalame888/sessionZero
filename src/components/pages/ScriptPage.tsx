import { useEffect, useMemo, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Sparkles } from "lucide-react";
import { TypingIndicator } from "@/components/chat/StoryLog";
import { Composer } from "@/components/chat/Composer";
import { TaskFeedback } from "@/components/pedelec/TaskFeedback";
import { HouseRulesBox } from "@/components/stages/HouseRulesBox";
import { Button } from "@/components/ui/button";
import { HoverTooltip } from "@/components/ui/hover-tooltip";
import { Modal } from "@/components/ui/modal";
import { sendPlayerAction } from "@/lib/pedelec/createGameSession";
import { getActiveSession } from "@/lib/pedelec/createGameSession";
import { AUTO_GENERATE_COC_SCRIPT_PROMPT } from "@/prompts/gmDirectives";
import { useGameStore } from "@/store/useGameStore";
import {
  CREATION_MODE_HINTS,
  CREATION_MODE_LABELS,
  normalizeCreationMode,
  resolveSkillBaseValue,
} from "@/engine/creation";
import type { CreationMode } from "@/types/game";

export function ScriptPage({
  composerDisabled,
  onRegenerate,
}: {
  composerDisabled: boolean;
  onRegenerate?: () => void;
}) {
  const script = useGameStore((s) => s.script);
  const appendSystem = useGameStore((s) => s.appendSystem);
  const characterSchema = useGameStore((s) => s.characterSchema);
  const history = useGameStore((s) => s.history);
  const advanceToCharacterPhase = useGameStore(
    (s) => s.advanceToCharacterPhase,
  );
  const isTyping = useGameStore((s) => s.isTyping);
  const userMessages = useMemo(() => {
    return (history ?? [])
      .filter((h) => h.playerInput && h.playerInput.trim().length > 0)
      .map((h) => ({ id: `turn-${h.turn}`, content: h.playerInput! }));
  }, [history]);
  const userMsgRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [generatingBlueprint, setGeneratingBlueprint] = useState(false);
  const [modeSwitchOpen, setModeSwitchOpen] = useState(false);
  const [pendingCreationMode, setPendingCreationMode] =
    useState<CreationMode | null>(null);
  const [hoveredCreationMode, setHoveredCreationMode] =
    useState<CreationMode | null>(null);
  const [tooltipAnchor, setTooltipAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const el = userMsgRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [userMessages.length, isTyping]);

  const recommendedMode = useMemo(() => {
    return script.recommended_creation_mode
      ? normalizeCreationMode(script.recommended_creation_mode)
      : null;
  }, [script.recommended_creation_mode]);

  const requestCreationBlueprint = async (chosenMode: CreationMode) => {
    const session = getActiveSession();
    if (!session || session.getStatus() !== "idle") {
      appendSystem("Session 未就緒，無法產生創角藍圖。");
      return;
    }
    setGeneratingBlueprint(true);
    try {
      await session.sendText(
        `此步驟是 Session 0「創角藍圖預覽」：請呼叫 generate_character_schema。` +
          `creation_mode 必須是 ${chosenMode}。` +
          `請提供 attribute_defs（含繁中 label 與 dice_formula）、` +
          `mode_config（ARRAY 給 standard_array；POINT_BUY 給 point_buy_pool/min/max；` +
          `SKILL_ALLOC 給 occupational_point_formula 與 interest_point_formula）、` +
          `recommended_skills（name/description 繁中，並請標 is_occupational=true 的職業技能）。` +
          `background_questions 請回傳為物件陣列 {id, category, question}。` +
          `starting_inventory、role_title_suggestion、mode_instructions 也請提供。` +
          `此為藍圖預覽：請不要在文字中給出最終屬性數字；最終數值由前端按藍圖規則處理（DICE/ARRAY/POINT_BUY/SKILL_ALLOC）。`,
      );
    } catch (err) {
      appendSystem(
        `產生創角藍圖失敗：${
          err instanceof Error ? err.message : "未知錯誤"
        }`,
      );
    } finally {
      setGeneratingBlueprint(false);
    }
  };

  // setup_script 完成後，會自動為 recommended mode 產生一次創角藍圖
  useEffect(() => {
    if (!recommendedMode) return;
    if (composerDisabled || generating || generatingBlueprint) return;
    if (!characterSchema) {
      void requestCreationBlueprint(recommendedMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendedMode, composerDisabled, generating, characterSchema]);

  const generateCocScript = async () => {
    if (composerDisabled || generating) return;
    setGenerating(true);
    try {
      await sendPlayerAction(AUTO_GENERATE_COC_SCRIPT_PROMPT);
    } catch (err) {
      appendSystem(
        `自動生成失敗：${err instanceof Error ? err.message : "未知錯誤"}`,
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[360px_1fr]">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface/70 p-3">
        <div className="shrink-0">
          <h2 className="brand-title text-lg text-ink">劇情討論</h2>
          <p className="mt-1 text-sm text-muted">
            這裡只顯示你的送出內容；GM 回覆以「劇本與藍圖資料」呈現。
          </p>
          <div className="mt-2">
            <TaskFeedback />
          </div>

          {userMessages.length === 0 && !script.public_summary ? (
            <div className="mt-3">
              <Button
                className="w-full"
                disabled={composerDisabled || generating}
                onClick={() => void generateCocScript()}
              >
                <Sparkles className="h-4 w-4" />
                {generating ? "正在生成…" : "請 AI 生成 CoC 劇本"}
              </Button>
            </div>
          ) : null}
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1 py-2"
          ref={userMsgRef}
        >
          {userMessages.length === 0 ? (
            <p className="text-sm text-muted">
              描述想玩的故事想法、氛圍或系統方向，然後送出開始討論。
            </p>
          ) : null}

          <div className="space-y-3">
            {userMessages.map((m) => (
              <div
                key={m.id}
                className="ml-auto max-w-[92%] rounded-lg bg-accent/20 px-3 py-2 text-sm"
              >
                <div className="mb-1 text-xs uppercase tracking-wide text-muted">
                  你
                </div>
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            ))}
            <TypingIndicator />
          </div>
        </div>

        <div className="shrink-0 pt-3">
          <Composer disabled={composerDisabled} onRegenerate={onRegenerate} />
        </div>
      </aside>

      <Tabs.Root defaultValue="story" asChild>
        <main className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface/70 p-3">
          <Tabs.List className="mb-3 flex shrink-0 gap-1 border-b border-border/60 pb-2">
            <Tabs.Trigger
              value="story"
              className="rounded px-3 py-1.5 text-sm text-muted data-[state=active]:bg-surface-2 data-[state=active]:text-ink"
            >
              劇情與藍圖
            </Tabs.Trigger>
            <Tabs.Trigger
              value="houserules"
              className="rounded px-3 py-1.5 text-sm text-muted data-[state=active]:bg-surface-2 data-[state=active]:text-ink"
            >
              房規設定
            </Tabs.Trigger>
          </Tabs.List>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <Tabs.Content value="story" className="space-y-3">
              {script.public_summary ? (
                <div className="rounded-md border border-border bg-bg/40 p-3 text-sm">
                  <div className="font-medium text-ink">
                    {script.public_summary.title}
                  </div>
                  <div className="mt-1 text-sm text-muted">
                    {script.system_id} · {script.public_summary.genre}
                  </div>
                  <p className="mt-2 text-sm text-ink/90">
                    {script.public_summary.background}
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    主角定位：{script.public_summary.protagonist_role}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted">
                  尚未建立劇本。點上方按鈕讓 AI 生成，或在左側送出想玩的氛圍與方向。
                </p>
              )}

              <div className="space-y-2 pt-1">
                <h3 className="brand-title text-sm text-ink">創角藍圖預覽</h3>
                <p className="text-sm text-muted">
                  {recommendedMode ? (
                    <>
                      AI 推薦模式：{" "}
                      <strong className="text-ink">
                        {CREATION_MODE_LABELS[recommendedMode]}
                      </strong>
                      {" — "}
                      <span>{CREATION_MODE_HINTS[recommendedMode]}</span>
                    </>
                  ) : (
                    "尚未取得 AI 推薦模式。"
                  )}
                </p>

                {characterSchema ? (
                  <div className="space-y-2 rounded-md border border-border/40 bg-surface/40 p-3 pt-2">

                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(CREATION_MODE_LABELS) as CreationMode[]).map(
                        (mode) => {
                          const currentMode = normalizeCreationMode(
                            characterSchema.creation_mode,
                          );
                          const isActive = mode === currentMode;
                          return (
                            <div
                              key={mode}
                              className="group relative"
                              onMouseEnter={(e) => {
                                const rect =
                                  (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                setHoveredCreationMode(mode);
                                setTooltipAnchor({
                                  x: rect.left + rect.width / 2,
                                  y: rect.top - 8,
                                });
                              }}
                              onMouseLeave={() => {
                                setHoveredCreationMode(null);
                                setTooltipAnchor(null);
                              }}
                            >
                              <Button
                                type="button"
                                variant={isActive ? "default" : "secondary"}
                                size="sm"
                                disabled={generatingBlueprint || modeSwitchOpen}
                                onClick={() => {
                                  if (isActive) return;
                                  setPendingCreationMode(mode);
                                  setModeSwitchOpen(true);
                                }}
                              >
                                {CREATION_MODE_LABELS[mode]}
                              </Button>
                            </div>
                          );
                        },
                      )}
                    </div>
                  </div>
                ) : null}

                {generatingBlueprint ? (
                  <p className="text-sm text-accent-2">正在產生創角藍圖…</p>
                ) : !characterSchema ? (
                  <p className="text-sm text-muted">等待 AI 生成創角規則。</p>
                ) : (
                  <div className="space-y-2 rounded-md border border-border/60 bg-bg/30 p-2 text-sm">
                    <div className="font-medium text-ink">
                      目前藍圖模式：
                      {CREATION_MODE_LABELS[
                        normalizeCreationMode(characterSchema.creation_mode)
                      ]}
                    </div>

                    <div>
                      <div className="text-muted">屬性（Attribute）</div>
                      <div className="mt-1 space-y-1">
                        {(characterSchema.attribute_defs ?? []).map((d) => (
                          <div
                            key={d.key}
                            className="flex justify-between gap-3"
                          >
                            <span className="text-ink/90">{d.label}</span>
                            <span className="text-muted">
                              {normalizeCreationMode(
                                characterSchema.creation_mode,
                              ) === "ARRAY"
                                ? "—"
                                : d.dice_formula ?? ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {normalizeCreationMode(characterSchema.creation_mode) ===
                      "ARRAY" &&
                    (characterSchema.standard_array?.length ?? 0) > 0 ? (
                      <div>
                        <div className="text-muted">標準陣列</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span>
                            {characterSchema.standard_array?.join(", ")}
                          </span>
                          {characterSchema.standard_array_source ===
                          "default" ? (
                            <span className="text-xs text-accent-2">
                              （AI 未提供，使用系統預設）
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {normalizeCreationMode(characterSchema.creation_mode) ===
                    "POINT_BUY" ? (
                      <div>
                        <div className="text-muted">點數購買（Point Buy）</div>
                        <div className="mt-1">
                          予算 {characterSchema.point_buy?.budget ?? "—"}，範圍{" "}
                          {characterSchema.point_buy?.min_score ?? "—"}–
                          {characterSchema.point_buy?.max_score ?? "—"}
                        </div>
                      </div>
                    ) : null}

                    {normalizeCreationMode(characterSchema.creation_mode) ===
                    "SKILL_ALLOC" ? (
                      <div>
                        <div className="text-muted">技能分配（雙點池）</div>
                        <div className="mt-1">
                          職業點：
                          {characterSchema.mode_config
                            ?.occupational_point_formula ?? "—"}
                          ，興趣點：
                          {characterSchema.mode_config
                            ?.interest_point_formula ?? "—"}
                        </div>
                      </div>
                    ) : null}

                    <div>
                      <div className="text-muted">
                        推薦技能（Base + 後續前端分配）
                      </div>
                      <div className="mt-1 space-y-1">
                        {(characterSchema.recommended_skills ?? [])
                          .slice(0, 10)
                          .map((s) => (
                            <div
                              key={s.name}
                              className="flex gap-3 justify-between"
                            >
                              <HoverTooltip
                                header={s.name}
                                content={s.description ?? ""}
                              >
                                <span
                                  className={
                                    s.is_occupational
                                      ? "text-ink underline decoration-dotted decoration-muted underline-offset-2"
                                      : "text-ink/90 underline decoration-dotted decoration-muted underline-offset-2"
                                  }
                                >
                                  {s.name}
                                  {s.is_occupational ? (
                                    <span className="ml-2 text-xs text-accent-2 no-underline">
                                      (職業)
                                    </span>
                                  ) : null}
                                </span>
                              </HoverTooltip>
                              <span className="text-muted">
                                +
                                {resolveSkillBaseValue(
                                  characterSchema.system_id,
                                  s.name,
                                  s.base_value,
                                )}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-muted">背景鉤子題目（Hooks）</div>
                      <div className="mt-1 space-y-2">
                        {(characterSchema.background_questions ?? [])
                          .slice(0, 4)
                          .map((q) => (
                            <div
                              key={q.id}
                              className="rounded border border-border/40 bg-surface/40 p-2"
                            >
                              <div className="text-xs text-muted">
                                {q.category}
                              </div>
                              <div className="mt-1 text-ink/90">
                                {q.question}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Tabs.Content>

            <Tabs.Content value="houserules" className="pt-3">
              <HouseRulesBox />
            </Tabs.Content>
          </div>

          <div className="shrink-0 pt-3">
            <Button
              className="w-full"
              disabled={
                composerDisabled ||
                !script.public_summary ||
                !characterSchema ||
                generatingBlueprint
              }
              onClick={() => advanceToCharacterPhase()}
            >
              完成劇本設定，前往創建角色卡
            </Button>
          </div>
        </main>
      </Tabs.Root>

      <Modal
        open={modeSwitchOpen}
        onOpenChange={(open) => {
          setModeSwitchOpen(open);
          if (!open) setPendingCreationMode(null);
        }}
        title="確認切換創角模式"
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">
            是否要改成使用{" "}
            <span className="text-ink">
              {pendingCreationMode
                ? CREATION_MODE_LABELS[pendingCreationMode]
                : ""}
            </span>
            模式創角？AI 會重新評估角色的數值規則。
          </p>

          {pendingCreationMode ? (
            <div className="rounded-md border border-border/40 bg-surface/40 p-3">
              <div className="text-sm font-medium text-ink">模式說明</div>
              <div className="mt-1 text-sm text-muted">
                {CREATION_MODE_HINTS[pendingCreationMode]}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setModeSwitchOpen(false);
                setPendingCreationMode(null);
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!pendingCreationMode) return;
                const mode = pendingCreationMode;
                setModeSwitchOpen(false);
                setPendingCreationMode(null);
                void requestCreationBlueprint(mode);
              }}
              disabled={generatingBlueprint || !pendingCreationMode}
            >
              確認
            </Button>
          </div>
        </div>
      </Modal>

      {hoveredCreationMode && tooltipAnchor ? (
        <div
          className="pointer-events-none fixed z-50 max-w-xs -translate-x-1/2 -translate-y-full rounded-md border border-[#9aa3b5]/50 bg-surface px-3 py-2 shadow-lg"
          style={{ left: tooltipAnchor.x, top: tooltipAnchor.y }}
        >
          <div className="mb-1 border-b border-border/50 pb-1 text-sm font-medium text-ink">
            {CREATION_MODE_LABELS[hoveredCreationMode]}
          </div>
          <div className="text-sm text-ink">
            {CREATION_MODE_HINTS[hoveredCreationMode]}
          </div>
        </div>
      ) : null}
    </div>
  );
}
