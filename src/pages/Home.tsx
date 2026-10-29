import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useAsync } from "@/lib/useAsync";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Leaf, BookOpen, Library, GraduationCap, Award, BookMarked, FileText, Layers, Soup } from "lucide-react";
import type { HomeResult, HomeSection, ModuleInfo } from "@/lib/types";

const ICONS: Record<string, any> = {
  BookOpen, Library, GraduationCap, Award, BookMarked, FileText, Layers, Soup,
};

export function Home() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const { data, loading } = useAsync(async () => {
    const [home, mods] = await Promise.all([api.home(), api.modules()]);
    return { home, mods };
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = q.trim();
    if (t) navigate(`/search?q=${encodeURIComponent(t)}`);
  };

  const home = data?.home as HomeResult | undefined;
  const mods = data?.mods as { modules: ModuleInfo[]; glossaryCount: number; textbookCount: number; examCount: number } | undefined;

  const studyCards = [
    { to: "/textbooks", icon: GraduationCap, title: "中医教材", desc: "按基础、临床、经典、人文分类梳理学习资料。", count: mods?.textbookCount },
    { to: "/exam", icon: Award, title: "备考资源", desc: "执业医师、考研中医综合等考试范围整理。", count: mods?.examCount },
    { to: "/manual", icon: BookMarked, title: "使用手册", desc: "平台功能、检索方法与数据说明。", count: undefined },
  ];

  return (
    <div className="animate-fade-in">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-tcm-paper to-card p-8 md:p-12">
        <div className="absolute -right-10 -top-10 opacity-10">
          <Leaf className="h-56 w-56 text-tcm-jade" />
        </div>
        <div className="relative max-w-2xl">
          <Badge variant="jade" className="mb-3">岐黄之术 · 薪火相传</Badge>
          <h1 className="font-serif text-3xl font-bold text-tcm-ink md:text-4xl">
            岐黄阁 · 中医知识查询平台
          </h1>
          <p className="mt-3 text-muted-foreground">
            集中医术语词典、著作检索、教材浏览、备考资源与使用手册于一体，查阅本草、汤方、古籍与医案，助力学习、临床与备考。
          </p>
          <form onSubmit={submit} className="mt-6 flex max-w-xl gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索药名、书名、病症、术语…"
                className="pl-9"
              />
            </div>
            <Button type="submit">检索</Button>
          </form>
        </div>
      </section>

      {/* 核心资料库 */}
      <h2 className="mb-4 mt-10 font-serif text-xl font-semibold">核心资料库</h2>
      {loading || !home ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-44 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {home.sections.map((s: HomeSection, i) => {
            const Icon = ICONS[s.icon] || BookOpen;
            return (
              <motion.div key={s.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                <Link to={`/${s.key}`}>
                  <Card className="h-full transition-all hover:border-primary/40 hover:shadow-md">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Icon className="h-5 w-5" />
                          </span>
                          <CardTitle className="text-lg">{s.name}</CardTitle>
                        </div>
                        <Badge variant="outline">{s.count.toLocaleString()} 条</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{s.desc}</p>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                        {s.samples.slice(0, 6).map((it) => (
                          <Link
                            key={it.id}
                            to={`/${s.key}/${it.id}`}
                            className="text-foreground/70 hover:text-primary hover:underline"
                          >
                            {it.title}
                          </Link>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* 学习资源 */}
      <h2 className="mb-4 mt-10 font-serif text-xl font-semibold">学习与备考</h2>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        {studyCards.map((c) => (
          <Link key={c.to} to={c.to}>
            <Card className="h-full transition-all hover:border-primary/40 hover:shadow-md">
              <CardContent className="p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-tcm-gold/15 text-tcm-gold">
                  <c.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-3 font-serif text-lg font-semibold">{c.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{c.desc}</p>
                {c.count != null && <p className="mt-2 text-xs text-muted-foreground">{c.count} 项</p>}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
