import { useParams, Link } from "react-router-dom";
import { useAsync } from "@/lib/useAsync";
import { api } from "@/lib/api";
import { Skeleton } from "./ui/skeleton";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { Button } from "./ui/button";
import { ArrowLeft, ArrowRight, ScrollText, Sprout } from "lucide-react";

const MODULE_NAME: Record<string, string> = {
  dictionary: "中医术语词典",
  works: "中医著作",
  yian: "医案心得",
  zaji: "杂集",
};

export function ResourceDetail({ module }: { module: string }) {
  const { id } = useParams();
  const { data, loading } = useAsync(() => api.resource(module, id as string), [module, id]);

  if (loading) {
    return (
      <div className="animate-fade-in space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-16 text-center">
        <p className="text-lg font-medium">未找到该条目</p>
        <Link to={`/${module}`} className="mt-3 inline-block text-primary hover:underline">
          返回列表
        </Link>
      </div>
    );
  }

  return (
    <article className="animate-fade-in">
      <div className="mb-4">
        <Link to={data.bookId ? `/works/book/${data.bookId}` : `/${module}`}>
          <Button variant="ghost" size="sm" className="mb-3 -ml-2 text-muted-foreground">
            <ArrowLeft className="h-4 w-4" /> 返回{MODULE_NAME[module] ?? "列表"}
          </Button>
        </Link>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {data.kind === "herb" ? <Sprout className="h-4 w-4 text-tcm-jade" /> : <ScrollText className="h-4 w-4 text-tcm-cinnabar" />}
          {data.bookTitle ? `出自《${data.bookTitle}》` : (MODULE_NAME[module] ?? module)}
        </div>
        <h1 className="mt-1 font-serif text-3xl font-bold text-tcm-ink">{data.title}</h1>
        {Object.keys(data.meta).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(data.meta).map(([k, v]) =>
              v ? (
                <Badge key={k} variant="secondary">
                  {k}：{v}
                </Badge>
              ) : null
            )}
          </div>
        )}
      </div>

      <Separator className="my-5" />

      {data.kind === "herb" && data.groups && (
        <div className="space-y-6">
          {data.groups.map((g) => (
            <section key={g.group}>
              <h2 className="mb-3 flex items-center gap-2 font-serif text-lg font-semibold text-primary">
                <span className="h-4 w-1 rounded bg-primary" />
                {g.group}
              </h2>
              <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                {g.fields.map((f) => (
                  <div key={f.label} className="border-b border-border/60 pb-2">
                    <dt className="text-xs text-muted-foreground">{f.label}</dt>
                    <dd className="mt-0.5 text-sm leading-relaxed text-foreground/90">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}

      {(data.kind === "book" || data.kind === "article" || data.kind === "herb") && data.prose && (
        <section className="mt-8">
          <h2 className="mb-3 flex items-center gap-2 font-serif text-lg font-semibold text-primary">
            <span className="h-4 w-1 rounded bg-primary" />
            {data.kind === "herb" ? "综合论述" : "正文"}
          </h2>
          <div
            className="prose-tcm max-w-none font-serif text-[15px]"
            dangerouslySetInnerHTML={{ __html: data.prose }}
          />
        </section>
      )}

      {data.keyword && (
        <div className="mt-8 text-sm text-muted-foreground">
          <span className="font-medium">关键词：</span>
          {data.keyword}
        </div>
      )}

      {data.nav && (data.nav.prev || data.nav.next) && (
        (() => {
          const navBase = module === "works" ? "/works/chapter" : `/${module}`;
          return (
        <nav className="mt-10 flex items-stretch justify-between gap-3 border-t border-border pt-5">
          {data.nav!.prev ? (
            <Link
              to={`${navBase}/${data.nav!.prev.id}`}
              className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border px-4 py-3 text-sm transition-colors hover:border-tcm-jade/50 hover:bg-tcm-jade/5"
            >
              <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-tcm-jade" />
              <span className="min-w-0">
                <span className="block text-xs text-muted-foreground">上一章</span>
                <span className="block truncate font-medium text-foreground group-hover:text-tcm-jade">{data.nav!.prev.title}</span>
              </span>
            </Link>
          ) : (
            <span className="flex-1" />
          )}
          {data.nav!.next ? (
            <Link
              to={`${navBase}/${data.nav!.next.id}`}
              className="group flex min-w-0 flex-1 items-center justify-end gap-2 rounded-lg border border-border px-4 py-3 text-sm transition-colors hover:border-tcm-jade/50 hover:bg-tcm-jade/5"
            >
              <span className="min-w-0 text-right">
                <span className="block text-xs text-muted-foreground">下一章</span>
                <span className="block truncate font-medium text-foreground group-hover:text-tcm-jade">{data.nav!.next.title}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-tcm-jade" />
            </Link>
          ) : (
            <span className="flex-1" />
          )}
        </nav>
          );
        })()
      )}
    </article>
  );
}
