import { SearchX } from "lucide-react";

export function EmptyState({
  title = "未找到相关结果",
  hint,
  action,
}: {
  title?: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
      <SearchX className="h-10 w-10 text-muted-foreground/50" />
      <p className="mt-3 font-medium text-foreground">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
