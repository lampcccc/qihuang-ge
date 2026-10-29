import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Search, Soup, Plus, X, Beaker, Leaf } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { FilterChips } from "@/components/FilterChips";
import { ToastStack, useToasts } from "@/components/Toaster";
import { RxForm } from "@/components/RxForm";
import { useAsync } from "@/lib/useAsync";
import { api } from "@/lib/api";
import type { RxListItem } from "@/lib/types";

export function Prescriptions() {
  // 与中药材列表一致：筛选条件以 URL 为唯一数据源，保证「详情 → 返回列表」与分享链接都能复原
  const [searchParams, setSearchParams] = useSearchParams();
  const letter = searchParams.get("letter") || "";
  const origin = searchParams.get("origin") || "";
  const effect = searchParams.get("effect") || "";
  const herb = searchParams.get("herb") || "";
  const herbName = searchParams.get("herbName") || "";
  const appliedQ = searchParams.get("q") || "";
  const page = Math.max(1, Number(searchParams.get("page") || 1) || 1);
  const [q, setQ] = useState(appliedQ);

  // 写操作（新建 / 编辑 / 删除）后的强制刷新计数
  const [tick, setTick] = useState(0);

  const { data, loading } = useAsync(
    () =>
      api.prescriptions({
        q: appliedQ || undefined,
        letter: letter || undefined,
        origin: origin || undefined,
        effect: effect || undefined,
        herb: herb || undefined,
        page,
      }),
    [appliedQ, letter, origin, effect, herb, page, tick]
  );

  function updateFilter(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in patch)) next.delete("page");
    setSearchParams(next, { replace: true });
  }

  const pickLetter = (k: string) => updateFilter({ letter: letter === k ? null : k });
  const pickOrigin = (k: string) => updateFilter({ origin: origin === k ? null : k });
  const pickEffect = (k: string) => updateFilter({ effect: effect === k ? null : k });

  // 清除「含某药材」时连同药材名一起清掉（名称仅用于展示提示条）
  const clearHerb = () => updateFilter({ herb: null, herbName: null });

  function resetAll() {
    setQ("");
    setSearchParams(new URLSearchParams(), { replace: true });
  }
  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    updateFilter({ q: q.trim() || null });
  }

  const hasFilter = !!(letter || origin || effect || herb || appliedQ);
  const letterOptions = (data?.facets.letters ?? []).map((l) => ({ key: l.letter, count: l.count }));
  const originOptions = (data?.facets.origins ?? []).map((o) => ({ key: o.value, count: o.count }));
  const effectOptions = (data?.facets.effects ?? []).map((e) => ({ key: e.value, count: e.count }));

  // ===== 新建汤方 =====
  const { toasts, dismiss, success, error: toastError } = useToasts();
  const [formOpen, setFormOpen] = useState(false);
  const refresh = () => {
    api.invalidate("/api/prescriptions");
    setTick((t) => t + 1);
  };

  return (
    <div className="animate-fade-in">
      {/* 头部 */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-tcm-jade/10 text-tcm-jade">
            <Soup className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-serif text-2xl font-bold text-foreground">汤方查询</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              收录 {data ? `${data.total} 首` : "方剂"}汤方，含组成药材（可反查药材详情）、煎煮服用方法与功效禁忌，支持自建与检索。
            </p>
          </div>
        </div>
        <Button className="bg-tcm-jade hover:bg-tcm-jade/90" onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4" /> 新建汤方
        </Button>
      </div>

      {/* 搜索 */}
      <form onSubmit={submitSearch} className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索方名 / 拼音 / 组成药材…"
            className="pl-9"
          />
        </div>
        <Button type="submit" className="bg-tcm-jade hover:bg-tcm-jade/90">
          搜索
        </Button>
      </form>

      {/* 筛选项 */}
      <div className="mb-5 space-y-3 rounded-xl border border-border bg-card/60 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground/90">
          <Soup className="h-4 w-4 text-tcm-jade" /> 条件筛选
        </div>
        <FilterChips label="拼音" options={letterOptions} active={letter} onPick={pickLetter} />
        <FilterChips label="出处" options={originOptions} active={origin} onPick={pickOrigin} />
        <FilterChips label="功效" options={effectOptions} active={effect} onPick={pickEffect} max={10} />
        {herb && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 text-xs font-medium text-muted-foreground">含药材</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-tcm-jade bg-tcm-jade/10 px-3 py-1 text-sm font-medium text-tcm-jade">
              <Leaf className="h-3.5 w-3.5" />
              {herbName || `药材 #${herb}`}
            </span>
            <button
              onClick={clearHerb}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-tcm-cinnabar"
            >
              <X className="h-3 w-3" /> 取消该条件
            </button>
          </div>
        )}
        {hasFilter && (
          <button onClick={resetAll} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-tcm-jade">
            <X className="h-3 w-3" /> 清除全部筛选
          </button>
        )}
      </div>

      {/* 结果计数 */}
      <div className="mb-3 text-sm text-muted-foreground">
        {!data ? "加载中…" : `找到 ${data.total} 首汤方`}
        {herb && <span className="ml-1 text-xs">（仅显示组成中含「{herbName || `药材 #${herb}`}」的汤方）</span>}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <motion.div
          key={`${letter}|${origin}|${effect}|${herb}|${appliedQ}|${page}|${tick}`}
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.03 } } }}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {data.items.map((it) => (
            <motion.div key={it.id} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }} className="h-full">
              <RxCard item={it} />
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <EmptyState
          title="未找到相关汤方"
          hint="没有匹配的汤方，试试调整筛选或关键词；也可以直接新建一首汤方"
          action={
            <Button variant="outline" size="sm" onClick={resetAll}>
              清除全部筛选
            </Button>
          }
        />
      )}

      {data && (
        <>
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onChange={(p) => updateFilter({ page: String(p) })}
          />
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            提示：汤方名称、组成、煎煮服用方法、功效与适应症、禁忌与备注沿用中药材模块的字段命名与校验规则；
            点击卡片可查看完整方剂，组成中已关联的药材可直接跳到药材详情。
          </p>
        </>
      )}

      <RxForm
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={null}
        onSaved={(r) => {
          refresh();
          success(`已创建汤方「${r.title}」`);
        }}
      />
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// ===== 汤方卡片（与药材卡片同构：名称 / 组成摘要 / 标签）=====
function RxCard({ item }: { item: RxListItem }) {
  return (
    <Link
      to={`/prescriptions/${item.id}`}
      className="group flex h-full flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-tcm-jade/50"
    >
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 truncate font-serif text-lg font-semibold text-tcm-ink group-hover:text-tcm-jade">
          {item.title}
        </h3>
        {item.custom && <Badge variant="gold" className="shrink-0">自建</Badge>}
      </div>
      {item.pinyin && <div className="mt-0.5 truncate text-xs italic text-tcm-jade">{item.pinyin}</div>}

      {item.subtitle && (
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-foreground/80">
          <Beaker className="mr-1 inline h-3 w-3 align-[-2px] text-muted-foreground" />
          {item.subtitle}
        </p>
      )}
      {item.gongneng && (
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.gongneng}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
        {item.effect && item.effect !== "其他" && <Badge variant="jade">{item.effect}</Badge>}
        {item.origin && item.origin !== "其他" && <Badge variant="outline">{item.origin}</Badge>}
        <span className="ml-auto text-[11px] text-muted-foreground">{item.herbCount} 味</span>
      </div>
    </Link>
  );
}
