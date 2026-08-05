import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { normalizeNarrativeText } from "@/lib/normalizeNarrativeText";
import { cn } from "@/lib/utils";

export function MarkdownContent({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const normalized = normalizeNarrativeText(content);
  return (
    <div className={cn("markdown-body", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalized}</ReactMarkdown>
    </div>
  );
}
