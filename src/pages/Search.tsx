import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useAsync } from "@/lib/useAsync";
import { api } from "@/lib/api";
import { ResourceCard } from "@/components/ResourceCard";
import { Pagination } from "@/components/Pagination";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search as SearchIcon } from "lucide-react";

export function Search() {
  const [params, setParams] = useSearchParams();
  const initialQ = params.get("q") || "";
  const [q, setQ] = useState(initialQ);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setQ(initialQ);
    setPage(1);
  }, [initialQ]);

  const { data, loading } = useAsync(() => api.search(initialQ, page), [initialQ, page]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = q.trim();
    setParams(t ? { q: t } : {});
    setPage(1);
  };

  return (
    <div className="animate-fade-in">
      <form onSubmit={submit} className="mb-6 flex gap-2 max-w-2xl">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="检索药名、书名、病症、术语…" className="pl-9" />
        </div>
        <Button type="submit">检索</Button>
      </form>

      {!initialQ ? (
        <EmptyState title="输入关键词开始检索" hint="支持药名、书名、病症、理论术语等" />
      ) : loading ? (
        <div className="space-y-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="mb-3 h-5 w-32" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, j) => <Skeleton key={j} className="h-24 w-full" />)}
              </div>
            </div>
          ))}
        </div>
      ) : data && data.total > 0 ? (
        <>
          <p className="mb-5 text-sm text-muted-foreground">
            “{data.q}” 共找到 <span className="font-medium text-primary">{data.total.toLocaleString()}</span> 条结果
          </p>
          <div className="space-y-8">
            {data.results.map((g) => (
              <section key={g.key}>
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="font-serif text-lg font-semibold">{g.name}</h2>
                  <span className="text-xs text-muted-foreground">{g.total.toLocaleString()} 条</span>
                </div>
                {g.items.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {g.items.map((it) => (
                      <ResourceCard key={it.id} item={it} module={g.key} />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">本类暂无匹配结果</p>
                )}
              </section>
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
