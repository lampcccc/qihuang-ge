import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";

export interface FacetOption {
  key: string;
  count: number;
}

// 筛选胶囊组：与中药材 / 汤方列表共用，超过 max 项时折叠
export function FilterChips({
  label,
  options,
  active,
  onPick,
  max,
}: {
  label: string;
  options: FacetOption[];
  active: string;
  onPick: (k: string) => void;
  max?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (options.length === 0) return null;
  const collapsible = !!max && options.length > max;
  const shown = collapsible && !expanded ? options.slice(0, max) : options;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-12 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      {shown.map((o) => {
        const isActive = active === o.key;
        return (
          <button
            key={o.key}
            onClick={() => onPick(o.key)}
            aria-pressed={isActive}
            className={
              "rounded-full border px-3 py-1 text-sm transition-colors " +
              (isActive
                ? "border-tcm-jade bg-tcm-jade/10 text-tcm-jade font-medium"
                : "border-border bg-card text-foreground/80 hover:border-tcm-jade/50 hover:text-tcm-jade")
            }
          >
            {o.key}
            <span className="ml-1 text-xs text-muted-foreground">{o.count}</span>
          </button>
        );
      })}
      {collapsible && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-tcm-jade"
        >
          {expanded ? "收起" : `展开全部 ${options.length} 项`}
        </button>
      )}
    </div>
  );
}

// 筛选面板容器（标题 + 若干行筛选 + 清除按钮插槽）
export function FilterPanel({
  title = "条件筛选",
  children,
  onReset,
  hasFilter,
}: {
  title?: string;
  children: React.ReactNode;
  onReset?: () => void;
  hasFilter?: boolean;
}) {
  return (
    <div className="mb-5 space-y-3 rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground/90">
        <SlidersHorizontal className="h-4 w-4 text-tcm-jade" /> {title}
      </div>
      {children}
      {hasFilter && onReset && (
        <button onClick={onReset} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-tcm-jade">
          <X className="h-3 w-3" /> 清除全部筛选
        </button>
      )}
    </div>
  );
}

// 工具条内的小按钮
export function MiniBtn({
  onClick,
  disabled,
  children,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        "rounded-md border border-border bg-card px-2 py-1 text-xs transition-colors " +
        (disabled
          ? "cursor-not-allowed text-muted-foreground/50"
          : "text-foreground/80 hover:border-tcm-jade/50 hover:text-tcm-jade")
      }
    >
      {children}
    </button>
  );
}
