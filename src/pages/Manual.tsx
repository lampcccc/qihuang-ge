import { useAsync } from "@/lib/useAsync";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BookMarked } from "lucide-react";

export function Manual() {
  const { data, loading } = useAsync(() => api.manual(), []);

  return (
    <div className="animate-fade-in max-w-3xl">
      <h1 className="font-serif text-2xl font-bold text-foreground">使用手册</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        了解平台功能、检索方法与数据说明，更快上手。
      </p>

      {loading || !data ? (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {data.sections.map((s, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 font-serif text-sm font-bold text-primary">
                    {i + 1}
                  </span>
                  <h3 className="flex items-center gap-2 font-serif text-lg font-semibold">
                    <BookMarked className="h-4 w-4 text-tcm-gold" />
                    {s.title}
                  </h3>
                </div>
                <p className="mt-2 pl-9 text-sm leading-relaxed text-foreground/85">{s.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
