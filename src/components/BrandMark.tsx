import { APP_VERSION } from "@/lib/appVersion";

type BrandMarkProps = {
  /** Header vs home hero */
  size?: "sm" | "lg";
  className?: string;
};

export function BrandMark({ size = "sm", className = "" }: BrandMarkProps) {
  const titleClass =
    size === "lg"
      ? "brand-title text-4xl text-ink md:text-5xl"
      : "brand-title text-xl text-ink md:text-2xl";
  const verClass =
    size === "lg"
      ? "translate-y-[-0.15em] text-xs font-medium tracking-wide text-muted md:text-sm"
      : "translate-y-[-0.1em] text-[10px] font-medium tracking-wide text-muted md:text-xs";

  return (
    <div className={`inline-flex items-baseline gap-2 ${className}`.trim()}>
      <h1 className={titleClass}>SessionZero</h1>
      <span className={verClass} title={`版本 ${APP_VERSION}`}>
        ver {APP_VERSION}
      </span>
    </div>
  );
}
