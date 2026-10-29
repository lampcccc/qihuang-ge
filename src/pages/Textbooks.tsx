import { Link } from "react-router-dom";
import { useAsync } from "@/lib/useAsync";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen } from "lucide-react";

export function Textbooks() {
  const { data, loading } = useAsync(() => api.textbooks(), []);

  return (
    <div className="animate-fade-in">
      <h1 className="font-serif text-2xl font-bold text-foreground">中医教材资料</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        按基础、临床、经典与人文分类梳理中医学习资料，便于系统研读与备课。
      </p>

      {loading || !data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {data.items.map((t) => (
            <Card key={t.id} className="h-full transition-all hover:border-primary/40 hover:shadow-md">
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-tcm-gold" />
                    <h3 className="font-serif text-lg font-semibold">{t.title}</h3>
                  </div>
                  <Badge variant="outline">{t.category}</Badge>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t.desc}</p>
                {t.related && (
                  <Link
                    to={`/${t.related.module}?q=${encodeURIComponent(t.related.query)}`}
                    className="mt-3 inline-block text-sm text-primary hover:underline"
                  >
                    查阅相关资料 →
                  </Link>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
