import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

function ModalNavButton({
  direction,
  label,
  onClick,
}: {
  direction: "prev" | "next";
  label: string;
  onClick: () => void;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "hidden shrink-0 items-center justify-center rounded-full border-2 border-border bg-surface text-ink shadow-lg transition-colors",
        "h-12 w-12 sm:flex",
        "hover:border-accent hover:bg-accent/15 hover:text-accent",
        "active:scale-95 active:bg-accent/25",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
      )}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon className="h-7 w-7" strokeWidth={2.25} />
    </button>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  className,
  bodyClassName,
  headerExtra,
  onPrevious,
  onNext,
  previousLabel = "上一項",
  nextLabel = "下一項",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  /** 可滾動內容區 class（header 固定不滾） */
  bodyClassName?: string;
  /** 標題列下方（例如隊伍切換） */
  headerExtra?: React.ReactNode;
  onPrevious?: () => void;
  onNext?: () => void;
  previousLabel?: string;
  nextLabel?: string;
}) {
  const showNav = Boolean(onPrevious || onNext);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none",
            showNav
              ? "flex w-[min(96vw,760px)] max-w-none items-center gap-3 border-0 bg-transparent p-0 shadow-none"
              : "flex max-h-[85vh] w-[min(92vw,520px)] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl",
            !showNav && className,
          )}
        >
          {showNav && onPrevious ? (
            <ModalNavButton
              direction="prev"
              label={previousLabel}
              onClick={onPrevious}
            />
          ) : null}
          <div
            className={cn(
              "flex max-h-[85vh] min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl",
              showNav ? cn("flex-1", className) : "w-full",
            )}
          >
            <div className="flex shrink-0 flex-col gap-2 border-b border-border px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Dialog.Title className="brand-title text-lg text-ink">
                    {title}
                  </Dialog.Title>
                  {subtitle ? (
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {subtitle}
                    </p>
                  ) : null}
                </div>
                <Dialog.Close className="rounded p-1 text-muted hover:bg-surface-2 hover:text-ink">
                  <X className="h-4 w-4" />
                </Dialog.Close>
              </div>
              {headerExtra}
            </div>
            <div
              className={cn(
                "min-h-0 flex-1 overflow-y-auto px-5 py-4",
                bodyClassName,
              )}
            >
              {children}
            </div>
          </div>
          {showNav && onNext ? (
            <ModalNavButton
              direction="next"
              label={nextLabel}
              onClick={onNext}
            />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
