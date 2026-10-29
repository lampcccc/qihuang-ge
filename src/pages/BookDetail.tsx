import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAsync } from "@/lib/useAsync";
import { api } from "@/lib/api";
import { Pagination } from "@/components/Pagination";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Search, Library, ArrowLeft } from "lucide-react";

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

const CHAPTER_PAGE_SIZE = 60;

export function BookDetail() {
  const { typeId } = useParams();
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [cPage, setCPage] = useState(1);

  const { data, loading } = useAsync(
    () => api.bookToc(typeId as string, applied || undefined),
    [typeId, applied]
  );

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCPage(1);
    setApplied(q.trim());
  };

  if (loading) {
    return (
      <div className="animate-fade-in space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <div className="space-y-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-16 text-center">
        <p className="text-lg font-medium">未找到该著作</p>
        <Link to="/works" className="mt-3 inline-block text-primary hover:underline">
          返回著作列表
        </Link>
      </div>
    );
  }

  const start = (cPage - 1) * CHAPTER_PAGE_SIZE;
  const pageChapters = data.chapters.slice(start, start + CHAPTER_PAGE_SIZE);

  return (
    <div className="animate-fade-in">
      <Link to="/works">
        <Button variant="ghost" size="sm" className="mb-3 -ml-2 text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> 返回著作列表
        </Button>
      </Link>

      <div className="mb-5 flex items-start gap-3">
        <div className="mt-1 rounded-lg bg-tcm-cinnabar/10 p-2 text-tcm-cinnabar">
          <Library className="h-5 w-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-3xl font-bold text-tcm-ink">{data.title}</h1>
            <Badge variant="outline">{BOOK_TAG[data.method] ?? "典籍"}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.author ? `作者：${data.author}${data.era ? `（${data.era}）` : ""} · ` : ""}
            共 {data.total.toLocaleString()} 章
            {applied ? ` · 检索“${applied}”命中 ${data.total} 章` : ""}
          </p>
        </div>
      </div>

      <form onSubmit={onSearch} className="mb-5 flex gap-2 max-w-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="在本书内检索章节…"
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary">
          检索
        </Button>
        {applied && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setQ("");
              setApplied("");
              setCPage(1);
            }}
          >
            清除
          </Button>
        )}
      </form>

      <Separator className="mb-4" />

      {pageChapters.length > 0 ? (
        <>
          <ul className="divide-y divide-border/60">
            {pageChapters.map((ch) => (
              <li key={ch.id}>
                <Link
                  to={`/works/chapter/${ch.id}`}
                  className="group flex items-baseline gap-3 py-2.5 transition-colors hover:text-primary"
                >
                  {ch.path && (
                    <span className="shrink-0 font-mono text-xs text-muted-foreground/70">
                      {ch.path}
                    </span>
                  )}
                  <span className="font-serif text-[15px] leading-snug text-foreground group-hover:text-primary">
                    {ch.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {data.chapters.length > CHAPTER_PAGE_SIZE && (
            <Pagination
              page={cPage}
              pageSize={CHAPTER_PAGE_SIZE}
              total={data.chapters.length}
              onChange={setCPage}
            />
          )}
        </>
      ) : (
        <EmptyState hint="本书内暂无匹配章节" />
      )}
    </div>
  );
}
