import { useState } from "react";
import { Link } from "react-router-dom";
import { useAsync } from "@/lib/useAsync";
import { api } from "@/lib/api";
import { Pagination } from "@/components/Pagination";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import type { BookListItem } from "@/lib/types";

// 还原方式 → 展示标签（用于提示书名的可信来源）
const BOOK_TAG: Record<string, string> = {
  override: "书名",
  bookmark: "书名",
  jianjie: "书名",
  chapter: "教材",
  classic: "典籍",
  author: "医家",
  topic: "主题",
  category: "类别",
  unknown: "典籍",
};

function bookSubtitle(it: BookListItem): string {
  if (it.method === "author") {
    return `医家著作${it.era ? ` · ${it.era}代` : ""} · 共 ${it.chapterCount} 章`;
  }
  if (it.method === "category") {
    return `共 ${it.chapterCount} 章${it.firstChapter ? ` · ${it.firstChapter}` : ""}`;
  }
  return `共 ${it.chapterCount} 章${it.firstChapter ? ` · ${it.firstChapter}` : ""}`;
}

export function WorksPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");

  const { data, loading } = useAsync(
    () => api.books(applied || undefined, page),
    [page, applied]
  );

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setApplied(q.trim());
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-foreground">中医著作</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          按书名聚合的历代中医古籍与专著，点击进入浏览目录并在线阅读。
        </p>
        {data && (
          <p className="mt-2 text-xs text-muted-foreground">
            共 {data.total.toLocaleString()} 部著作
          </p>
        )}
      </div>

      <form onSubmit={onSearch} className="mb-6 flex gap-2 max-w-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="检索书名 / 作者 / 内容…"
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary">
          筛选
        </Button>
        {applied && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setQ("");
              setApplied("");
              setPage(1);
            }}
          >
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
              <Link
                key={it.typeId}
                to={`/works/book/${it.typeId}`}
                className="group block"
              >
                <Card className="h-full transition-all hover:border-primary/40 hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-serif text-base font-semibold leading-snug text-foreground group-hover:text-primary">
                        {it.title}
                      </h3>
                      <Badge variant="outline" className="shrink-0">
                        {BOOK_TAG[it.method] ?? "典籍"}
                      </Badge>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                      {bookSubtitle(it)}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          <Pagination
            page={page}
            pageSize={data.pageSize}
            total={data.total}
            onChange={setPage}
          />
        </>
      ) : (
        <EmptyState hint="换个关键词试试" />
      )}
    </div>
  );
}
