import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { ModuleBrowser } from "@/components/ModuleBrowser";
import { useAsync } from "@/lib/useAsync";
import { api } from "@/lib/api";
import { Search } from "lucide-react";

function GlossaryBrowser() {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [cat, setCat] = useState("");
  const { data, loading } = useAsync(() => api.glossary(applied || undefined, cat || undefined), [applied, cat]);

  return (
    <div>
      <form
        onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()); }}
        className="mb-4 flex gap-2 max-w-xl"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="检索理论术语…" className="pl-9" />
        </div>
        <Button type="submit" variant="secondary">筛选</Button>
      </form>

      {data && (
        <div className="mb-5 flex flex-wrap gap-2">
          <Badge variant={cat === "" ? "default" : "outline"} className="cursor-pointer" onClick={() => setCat("")}>
            全部
          </Badge>
          {data.categories.map((c) => (
            <Badge
              key={c}
              variant={cat === c ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setCat(c === cat ? "" : c)}
            >
              {c}
            </Badge>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : data && data.items.length > 0 ? (
        <div className="space-y-3">
          {data.items.map((t) => (
            <div key={t.term} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-baseline gap-3">
                <h3 className="font-serif text-lg font-semibold text-tcm-ink">{t.term}</h3>
                <span className="text-sm text-tcm-jade">{t.pinyin}</span>
                <Badge variant="gold" className="ml-auto">{t.category}</Badge>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-foreground/85">{t.definition}</p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState hint="换个关键词试试" />
      )}
    </div>
  );
}

export function Dictionary() {
  return (
    <div className="animate-fade-in">
      <h1 className="mb-1 font-serif text-2xl font-bold text-foreground">中医术语词典</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        涵盖中药材 / 方剂的专业术语，以及阴阳、五行、辨证等核心理论概念释义。
      </p>
      <Tabs defaultValue="drug">
        <TabsList>
          <TabsTrigger value="drug">药物术语（药材 / 方剂）</TabsTrigger>
          <TabsTrigger value="theory">理论术语</TabsTrigger>
        </TabsList>
        <TabsContent value="drug">
          <ModuleBrowser
            module="dictionary"
            title="药物术语"
            description="中药材与方剂的名称、性味、归经、功能主治等。点击条目查看完整信息。"
            placeholder="检索药名 / 别名 / 拼音…"
          />
        </TabsContent>
        <TabsContent value="theory">
          <GlossaryBrowser />
        </TabsContent>
      </Tabs>
    </div>
  );
}
