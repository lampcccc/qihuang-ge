import { useAsync } from "@/lib/useAsync";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Award } from "lucide-react";

export function Exam() {
  const { data, loading } = useAsync(() => api.exam(), []);

  return (
    <div className="animate-fade-in">
      <h1 className="font-serif text-2xl font-bold text-foreground">备考资源整理</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        汇总常见中医类考试的考查范围，帮助你制定针对性的复习计划。
      </p>

      {loading || !data ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {data.items.map((e) => (
            <Card key={e.id}>
              <CardContent className="p-5">
                <div className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-tcm-cinnabar" />
                  <h3 className="font-serif text-lg font-semibold">{e.title}</h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{e.desc}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {e.scope.map((s) => (
                    <Badge key={s} variant="secondary">{s}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
