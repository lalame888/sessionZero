import { CharacterStage } from "@/components/stages/CharacterStage";
import { useGameStore } from "@/store/useGameStore";

export function CharacterPage() {
  const script = useGameStore((s) => s.script);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface/70 p-4">
      <div className="mb-4 shrink-0">
        <h2 className="brand-title text-xl text-ink">創角</h2>
        <p className="mt-1 text-sm text-muted">
          {script.public_summary?.title
            ? `劇本「${script.public_summary.title}」`
            : "目前劇本"}
          {script.system_id ? ` · ${script.system_id}` : ""}
          。專心完成角色卡後再進入冒險。
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CharacterStage />
      </div>
    </div>
  );
}
