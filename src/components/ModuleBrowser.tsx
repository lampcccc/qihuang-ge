import { useState } from "react";
import { useAsync } from "@/lib/useAsync";
import { api } from "@/lib/api";
import { ResourceCard } from "./ResourceCard";
import { Pagination } from "./Pagination";
import { EmptyState } from "./EmptyState";
import { Skeleton } from "./ui/skeleton";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Search } from "lucide-react";

export function ModuleBrowser({
  module,
  title,
  description,
  placeholder = "在本书库内检索…",
}: {
  module: string;
  title: string;
  description: string;
  placeholder?: string;
}) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");

  const { data, loading } = useAsync(
    () => api.list(module, page, applied || undefined),
    [module, page, applied]
  );

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setApplied(q.trim());
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        {data && (
          <p className="mt-2 text-xs text-muted-foreground">共 {data.total.toLocaleString()} 条记录</p>
        )}
      </div>

      <form onSubmit={onSearch} className="mb-6 flex gap-2 max-w-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder}
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary">
          筛选
        </Button>
        {applied && (
          <Button type="button" variant="ghost" onClick={() => { setQ(""); setApplied(""); setPage(1); }}>
            清除
          </Button>
        )}
      </form>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((it) => (
              <ResourceCard key={it.id} item={it} module={module} />
            ))}
          </div>
          <Pagination page={page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
        </>
      ) : (
        <EmptyState hint="换个关键词试试" />
      )}
    </div>
  );
}
