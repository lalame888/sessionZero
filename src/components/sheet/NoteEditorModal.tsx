import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

export type NoteEditorValues = {
  title: string;
  content: string;
};

export function NoteEditorModal({
  open,
  onOpenChange,
  initialTitle = "",
  initialContent = "",
  mode = "create",
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle?: string;
  initialContent?: string;
  mode?: "create" | "edit";
  onSave: (values: NoteEditorValues) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);

  useEffect(() => {
    if (!open) return;
    setTitle(initialTitle);
    setContent(initialContent);
  }, [open, initialTitle, initialContent]);

  const canSave = content.trim().length > 0;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "edit" ? "編輯筆記" : "新增筆記"}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="note-title">標題（可留空）</Label>
          <Input
            id="note-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="選填標題"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="note-content">內文</Label>
          <Textarea
            id="note-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="寫下關鍵資訊…"
            className="min-h-[140px]"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={!canSave}
            onClick={() => {
              if (!canSave) return;
              onSave({ title: title.trim(), content: content.trim() });
              onOpenChange(false);
            }}
          >
            儲存
          </Button>
        </div>
      </div>
    </Modal>
  );
}
