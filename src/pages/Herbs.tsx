import { useState, useMemo, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Leaf, SlidersHorizontal, X, FlaskConical, Compass,
  Check, Square, Combine, Split, Undo2, ChevronDown, ChevronUp, Layers, Archive, Soup,
} from "lucide-react";
import { FilterChips, MiniBtn } from "@/components/FilterChips";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { ToastStack, useToasts } from "@/components/Toaster";
import { useAsync } from "@/lib/useAsync";
import { api } from "@/lib/api";
import type { NatureFlavorMatrix, HerbItem } from "@/lib/types";
import {
  keyOf, isCombo, flattenCards, buildCombo, validateMerge, pruneCombos,
  loadMergeState, saveMergeState, pushHistoryEntry,
} from "@/lib/cardMerge";
import type { Card, ComboCard, HiddenMap, HiddenMode, HistoryEntry, MergeSnapshot } from "@/lib/cardMerge";

const NATURE_ORDER = ["温", "热", "寒", "凉", "平", "其他"];
const FLAVOR_ORDER = ["辛", "甘", "酸", "苦", "咸", "其他"];

export function Herbs() {
  // 筛选状态以 URL 为唯一数据源：详情页「浏览同类」跳回、浏览器前进后退、刷新分享链接都能保留筛选。
  // （详情改为整页路由后，列表组件会重新挂载，若仍用组件内 useState 则会丢失筛选条件。）
  const [searchParams, setSearchParams] = useSearchParams();
  const letter = searchParams.get("letter") || "";
  const nature = searchParams.get("nature") || "";
  const flavor = searchParams.get("flavor") || "";
  const effect = searchParams.get("effect") || "";
  const meridian = searchParams.get("meridian") || "";
  const appliedQ = searchParams.get("q") || "";
  const page = Math.max(1, Number(searchParams.get("page") || 1) || 1);
  const [q, setQ] = useState(appliedQ); // 搜索框未提交的值（纯局部 UI 状态）

  // 合并 / 拆分后强制刷新服务端数据（同时用于刷新计数）
  const [tick, setTick] = useState(0);

  const { data, loading } = useAsync(
    () => api.herbs({
      q: appliedQ || undefined,
      letter: letter || undefined,
      nature: nature || undefined,
      flavor: flavor || undefined,
      effect: effect || undefined,
      meridian: meridian || undefined,
      page,
    }),
    [appliedQ, letter, nature, flavor, effect, meridian, page, tick]
  );

  // 统一更新筛选：改动任一维度都回到第 1 页
  function updateFilter(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in patch)) next.delete("page");
    setSearchParams(next, { replace: true });
  }

  // 视图切换：卡片列表 / 四性×五味聚合（矩阵仅在切到聚合视图时才请求）
  const [view, setView] = useState<"list" | "matrix">("list");
  const { data: matrix, loading: matrixLoading } = useAsync<NatureFlavorMatrix | null>(
    () => (view === "matrix" ? api.herbsMatrix() : Promise.resolve(null)),
    [view]
  );

  // 从聚合视图交叉筛选后跳回列表查看结果（聚合视图仅按性味交叉，故清空功效条件）
  function crossFilter(natureVal: string, flavorVal: string) {
    updateFilter({ nature: natureVal || null, flavor: flavorVal || null, effect: null });
    setView("list");
  }

  const hasFilter = !!(letter || nature || flavor || effect || meridian || appliedQ);

  const letterOptions = useMemo(
    () => (data?.facets.letters ?? []).map((l) => ({ key: l.letter as string, count: l.count })),
    [data]
  );
  const natureOptions = useMemo(() => {
    const map = new Map((data?.facets.natures ?? []).map((n) => [n.value as string, n.count]));
    return NATURE_ORDER.filter((k) => map.has(k)).map((k) => ({ key: k, count: map.get(k)! }));
  }, [data]);
  const flavorOptions = useMemo(() => {
    const map = new Map((data?.facets.flavors ?? []).map((n) => [n.value as string, n.count]));
    return FLAVOR_ORDER.filter((k) => map.has(k)).map((k) => ({ key: k, count: map.get(k)! }));
  }, [data]);
  const effectOptions = useMemo(
    () => (data?.facets.effects ?? []).map((e) => ({ key: e.value as string, count: e.count })),
    [data]
  );
  const meridianOptions = useMemo(
    () => (data?.facets.meridians ?? []).map((m) => ({ key: m.value as string, count: m.count })),
    [data]
  );

  const pickLetter = (k: string) => updateFilter({ letter: letter === k ? null : k });
  const pickNature = (k: string) => updateFilter({ nature: nature === k ? null : k });
  const pickFlavor = (k: string) => updateFilter({ flavor: flavor === k ? null : k });
  const pickEffect = (k: string) => updateFilter({ effect: effect === k ? null : k });
  const pickMeridian = (k: string) => updateFilter({ meridian: meridian === k ? null : k });

  function resetAll() {
    setQ("");
    setSearchParams(new URLSearchParams(), { replace: true });
  }
  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    updateFilter({ q: q.trim() || null });
  }

  // ===== 多选 / 合并 状态 =====
  const { toasts, dismiss, success, error: toastError, info: toastInfo } = useToasts();
  const boot = useMemo(() => loadMergeState("herbs"), []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorIdx, setAnchorIdx] = useState<number | null>(null); // 连续多选（Shift）的锚点
  const [removedMode, setRemovedMode] = useState<HiddenMode>("remove"); // 合并后原卡片：移除 / 归档
  const [combos, setCombos] = useState<ComboCard[]>(boot.combos);
  const [hidden, setHidden] = useState<HiddenMap>(boot.hidden);
  const [history, setHistory] = useState<HistoryEntry[]>(boot.history);
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // 展开查看来源的组合

  // 组合卡片与已合并卡片写入本地存储，刷新 / 返回列表后仍在
  useEffect(() => {
    saveMergeState("herbs", { combos, hidden, history });
  }, [combos, hidden, history]);

  // 翻页 / 改筛选后卡片集合变化，清空选择避免误合并
  const filterKey = `${letter}|${nature}|${flavor}|${effect}|${meridian}|${appliedQ}|${page}`;
  useEffect(() => {
    setSelected(new Set());
    setAnchorIdx(null);
  }, [filterKey]);

  // 展示序列：组合卡片置顶，其后为未被合并掉的卡片
  const visibleItems = useMemo(
    () => (data?.items ?? []).filter((it) => !hidden[String(it.id)]),
    [data, hidden]
  );
  const cards = useMemo<Card[]>(() => [...combos, ...visibleItems], [combos, visibleItems]);
  const keys = useMemo(() => cards.map(keyOf), [cards]);
  const picked = useMemo(() => cards.filter((c) => selected.has(keyOf(c))), [cards, selected]);
  const selCount = picked.length;

  const refreshList = useCallback(() => {
    api.invalidate("/api/herbs"); // 清掉前端缓存，保证重新请求并刷新计数
    setTick((t) => t + 1);
  }, []);

  const toggleSelect = useCallback(
    (key: string, index: number, shift: boolean) => {
      const next = new Set(selected);
      if (shift && anchorIdx != null && anchorIdx !== index) {
        // 连续多选：以锚点为起点，整段统一选中 / 取消
        const [a, b] = anchorIdx < index ? [anchorIdx, index] : [index, anchorIdx];
        const add = !selected.has(key);
        for (let i = a; i <= b; i++) {
          if (add) next.add(keys[i]);
          else next.delete(keys[i]);
        }
      } else {
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setAnchorIdx(index); // 记录锚点，供下一次 Shift 点击使用
      }
      setSelected(next);
    },
    [selected, anchorIdx, keys]
  );

  const selectAll = useCallback(() => setSelected(new Set(keys)), [keys]);
  const invertSelect = useCallback(
    () => setSelected(new Set(keys.filter((k) => !selected.has(k)))),
    [keys, selected]
  );
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const snapshot = (): MergeSnapshot => ({ combos, hidden });

  // 撤销：回退到上一次操作前的完整状态（合并 / 拆分 / 归档还原都进历史）
  const undo = useCallback(() => {
    if (history.length === 0) {
      toastInfo("没有可撤销的操作");
      return;
    }
    const last = history[history.length - 1];
    setCombos(last.snapshot.combos);
    setHidden(last.snapshot.hidden);
    setHistory((h) => h.slice(0, -1));
    setSelected(new Set());
    refreshList();
    toastInfo(`已撤销：${last.label}`);
  }, [history, refreshList, toastInfo]);

  // 合并：摊平组合 -> 去重 -> 以列表中最靠前的卡片为主卡生成组合卡片
  const doMerge = useCallback(() => {
    const check = validateMerge(picked);
    if (!check.ok) {
      toastError(check.reason);
      return;
    }
    const { sources, comboIds } = flattenCards(picked);
    const combo = buildCombo(sources, String(sources[0].id));
    setHistory((h) => pushHistoryEntry(h, `合并 ${sources.length} 张卡片`, snapshot()));
    setCombos((cs) => [...cs.filter((c) => !comboIds.includes(keyOf(c))), combo]);
    setHidden((h) => {
      const nx: HiddenMap = { ...h };
      for (const s of sources) nx[String(s.id)] = { title: s.title, mode: removedMode };
      return nx;
    });
    setSelected(new Set());
    setExpanded((prev) => new Set(prev).add(combo.id));
    refreshList();
    success(`已合并 ${sources.length} 张为「${combo.title}」`, { actionLabel: "撤销", onAction: undo });
  }, [picked, combos, hidden, removedMode, refreshList, success, toastError, undo]);

  // 拆分还原：移除组合卡片，其下子卡片重新出现在列表中
  const splitCombo = useCallback(
    (c: ComboCard) => {
      setHistory((h) => pushHistoryEntry(h, `拆分「${c.title}」`, snapshot()));
      setCombos((cs) => cs.filter((x) => x.id !== c.id));
      setHidden((h) => {
        const nx: HiddenMap = { ...h };
        for (const s of c.sources) delete nx[String(s.id)];
        return nx;
      });
      setSelected((prev) => {
        const nx = new Set(prev);
        nx.delete(keyOf(c));
        return nx;
      });
      setExpanded((prev) => {
        const nx = new Set(prev);
        nx.delete(c.id);
        return nx;
      });
      refreshList();
      toastInfo(`已拆分还原 ${c.sources.length} 张卡片`, { actionLabel: "撤销", onAction: undo });
    },
    [combos, hidden, refreshList, toastInfo, undo]
  );

  // 归档还原（归档的原卡片不在列表中，可从归档区单独恢复）
  const archived = useMemo(
    () =>
      Object.entries(hidden)
        .filter(([, v]) => v.mode === "archive")
        .map(([id, v]) => ({ id, title: v.title })),
    [hidden]
  );
  const restoreHidden = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      // 归档卡片还原 = 从所属组合中移出；组合不足 2 张则自动解散并还原其余子卡片
      const { combos: nextCombos, dissolvedIds, removedComboIds } = pruneCombos(combos, new Set(ids));
      const restored = Array.from(new Set([...ids, ...dissolvedIds]));
      setHistory((h) => pushHistoryEntry(h, `还原 ${ids.length} 张卡片`, snapshot()));
      setCombos(nextCombos);
      setHidden((h) => {
        const nx: HiddenMap = { ...h };
        for (const id of restored) delete nx[id];
        return nx;
      });
      setExpanded((prev) => {
        const nx = new Set(prev);
        for (const id of removedComboIds) nx.delete(id);
        return nx;
      });
      setSelected((prev) => {
        const nx = new Set(prev);
        for (const id of removedComboIds) nx.delete(id);
        return nx;
      });
      refreshList();
      toastInfo(
        dissolvedIds.length > 0
          ? `已还原 ${restored.length} 张卡片（组合不足 2 张已自动解散）`
          : `已还原 ${ids.length} 张卡片`,
        { actionLabel: "撤销", onAction: undo }
      );
    },
    [combos, hidden, refreshList, toastInfo, undo]
  );

  // 计数：服务端总数 - 已合并掉的原卡片 + 组合卡片
  const removedCount = Object.keys(hidden).length;
  const serverTotal = data?.total ?? 0;
  const displayTotal = Math.max(0, serverTotal - removedCount + combos.length);

  return (
    <div className="animate-fade-in">
      {/* 头部 */}
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-tcm-jade/10 text-tcm-jade">
          <Leaf className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-serif text-2xl font-bold text-foreground">中药材查询</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            收录《中药大辞典》《中华本草》等来源的中药材 {data ? `共 ${data.facets.letters.reduce((s, l) => s + l.count, 0)} 味` : ""}，支持拼音检索、性味筛选与功效浏览。
          </p>
        </div>
        {/* 汤方是本模块的子模块：列表页给出直达入口 */}
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link to="/prescriptions">
            <Soup className="h-3.5 w-3.5" /> 汤方
          </Link>
        </Button>
      </div>

      {/* 搜索 */}
      <form onSubmit={submitSearch} className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索药名 / 别名 / 拼音 / 功效…"
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
          <SlidersHorizontal className="h-4 w-4 text-tcm-jade" /> 条件筛选
        </div>
        <FilterChips label="拼音" options={letterOptions} active={letter} onPick={pickLetter} />
        <FilterChips label="四气" options={natureOptions} active={nature} onPick={pickNature} />
        <FilterChips label="五味" options={flavorOptions} active={flavor} onPick={pickFlavor} />
        <FilterChips label="功效" options={effectOptions} active={effect} onPick={pickEffect} max={10} />
        <FilterChips label="归经" options={meridianOptions} active={meridian} onPick={pickMeridian} />
        {hasFilter && (
          <button onClick={resetAll} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-tcm-jade">
            <X className="h-3 w-3" /> 清除全部筛选
          </button>
        )}
      </div>

      {/* 结果计数 + 视图切换 */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {!data ? (
            "加载中…"
          ) : (
            <>
              找到 {displayTotal} 味药材
              {combos.length > 0 && `（含 ${combos.length} 张组合卡片）`}
            </>
          )}
        </div>
        <div className="flex shrink-0 rounded-lg border border-border bg-card p-0.5">
          <button
            onClick={() => setView("list")}
            className={
              "rounded-md px-3 py-1 text-xs transition-colors " +
              (view === "list" ? "bg-tcm-jade/10 font-medium text-tcm-jade" : "text-muted-foreground hover:text-foreground")
            }
          >
            卡片列表
          </button>
          <button
            onClick={() => setView("matrix")}
            className={
              "rounded-md px-3 py-1 text-xs transition-colors " +
              (view === "matrix" ? "bg-tcm-jade/10 font-medium text-tcm-jade" : "text-muted-foreground hover:text-foreground")
            }
          >
            性味聚合
          </button>
        </div>
      </div>

      {/* 多选：已选数量 + 全选 / 反选 / 合并 / 撤销（仅卡片列表视图） */}
      {view === "list" && (
        <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/95 p-2.5 text-sm backdrop-blur">
          <span className="flex flex-wrap items-center gap-1.5 text-foreground/80">
            <Layers className="h-4 w-4 shrink-0 text-tcm-jade" />
            已选 <b className="text-tcm-jade">{selCount}</b> / {cards.length} 张
            {selCount === 1 && <span className="text-xs text-muted-foreground">（再选 1 张即可合并）</span>}
            {selCount >= 2 && picked[0] && (
              <span className="text-xs text-muted-foreground">主卡：{picked[0].title}</span>
            )}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <MiniBtn onClick={selectAll} disabled={cards.length === 0} title="选择当前页全部卡片">
              全选
            </MiniBtn>
            <MiniBtn onClick={invertSelect} disabled={cards.length === 0} title="反选当前页卡片">
              反选
            </MiniBtn>
            {selCount > 0 && <MiniBtn onClick={clearSelection}>取消选择</MiniBtn>}
            <span className="mx-0.5 hidden h-4 w-px bg-border sm:block" />
            <div className="flex rounded-lg border border-border bg-card p-0.5">
              {(["remove", "archive"] as HiddenMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setRemovedMode(m)}
                  title={m === "remove" ? "合并后原卡片从列表移除" : "合并后原卡片移入归档区，可单独还原"}
                  className={
                    "rounded-md px-2 py-0.5 text-xs transition-colors " +
                    (removedMode === m
                      ? "bg-tcm-gold/15 font-medium text-tcm-gold"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {m === "remove" ? "移除" : "归档"}
                </button>
              ))}
            </div>
            <button
              onClick={doMerge}
              disabled={selCount < 2}
              title={selCount < 2 ? "至少选择 2 张卡片才能合并" : `将 ${selCount} 张卡片合并为 1 张组合卡片`}
              className={
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors " +
                (selCount < 2
                  ? "cursor-not-allowed bg-muted text-muted-foreground/50"
                  : "bg-tcm-jade text-white hover:bg-tcm-jade/90")
              }
            >
              <Combine className="h-3.5 w-3.5" /> 合并所选
            </button>
            <button
              onClick={undo}
              disabled={history.length === 0}
              title="撤销上一次合并 / 拆分 / 还原"
              className={
                "inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs transition-colors " +
                (history.length === 0
                  ? "cursor-not-allowed text-muted-foreground/50"
                  : "text-foreground/80 hover:border-tcm-jade/50 hover:text-tcm-jade")
              }
            >
              <Undo2 className="h-3.5 w-3.5" /> 撤销
            </button>
          </div>
        </div>
      )}

      {/* 归档区：合并时选择「归档」的原卡片 */}
      {view === "list" && archived.length > 0 && (
        <div className="mb-3 rounded-xl border border-dashed border-tcm-gold/40 bg-tcm-gold/5 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 font-medium text-tcm-gold">
              <Archive className="h-3.5 w-3.5" /> 已归档 {archived.length} 张（不在列表中）
            </span>
            <button
              onClick={() => restoreHidden(archived.map((a) => a.id))}
              className="ml-auto rounded-md border border-tcm-gold/40 px-2 py-0.5 text-tcm-gold transition-colors hover:bg-tcm-gold/10"
            >
              全部还原
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {archived.slice(0, 24).map((a) => (
              <button
                key={a.id}
                onClick={() => restoreHidden([a.id])}
                title="点击还原该卡片"
                className="group inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-xs text-foreground/80 transition-colors hover:border-tcm-jade/50 hover:text-tcm-jade"
              >
                {a.title}
                <X className="h-3 w-3 text-muted-foreground/50 group-hover:text-tcm-jade" />
              </button>
            ))}
            {archived.length > 24 && <span className="text-xs text-muted-foreground">等 {archived.length} 张</span>}
          </div>
        </div>
      )}

      {/* 列表 / 聚合视图 */}
      {view === "matrix" ? (
        <NatureFlavorView
          matrix={matrix ?? null}
          loading={matrixLoading}
          activeNature={nature}
          activeFlavor={flavor}
          onCrossFilter={crossFilter}
        />
      ) : loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : data && cards.length > 0 ? (
        <motion.div
          key={`${filterKey}-${tick}`}
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.03 } } }}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {cards.map((c, idx) => (
            <motion.div key={keyOf(c)} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }} className="h-full">
              {isCombo(c) ? (
                <ComboCardView
                  card={c}
                  index={idx}
                  selected={selected.has(keyOf(c))}
                  onToggle={toggleSelect}
                  expanded={expanded.has(c.id)}
                  onToggleExpand={() =>
                    setExpanded((prev) => {
                      const nx = new Set(prev);
                      if (nx.has(c.id)) nx.delete(c.id);
                      else nx.add(c.id);
                      return nx;
                    })
                  }
                  onSplit={() => splitCombo(c)}
                />
              ) : (
                <HerbCardView
                  item={c}
                  index={idx}
                  selected={selected.has(keyOf(c))}
                  onToggle={toggleSelect}
                />
              )}
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <EmptyState
          title={removedCount > 0 ? "当前页卡片已全部合并" : "未找到相关结果"}
          hint={
            removedCount > 0
              ? "合并后的卡片以组合卡片形式展示，刷新列表后仍可查看与拆分"
              : "没有匹配的药材，试试调整筛选或关键词"
          }
          action={
            history.length > 0 ? (
              <Button variant="secondary" size="sm" onClick={undo}>
                <Undo2 className="mr-1 h-3.5 w-3.5" /> 撤销上一次操作
              </Button>
            ) : null
          }
        />
      )}

      {data && view === "list" && (
        <>
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={Math.max(0, data.total - removedCount)}
            onChange={(p) => updateFilter({ page: String(p) })}
          />
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            提示：点击卡片右上角方框可勾选（Shift + 点击可连续多选）；选中 2 张以上可合并为组合卡片，标题以列表中最靠前的卡片为准，性味与功效自动去重合并。
            组合卡片可展开查看来源、一键拆分还原，合并后支持撤销。
          </p>
        </>
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// ===== 普通药材卡片（含勾选框）=====
function HerbCardView({
  item,
  index,
  selected,
  onToggle,
}: {
  item: HerbItem;
  index: number;
  selected: boolean;
  onToggle: (key: string, index: number, shift: boolean) => void;
}) {
  return (
    <div className="relative h-full">
      {/* 详情为整页路由：跳转 /herbs/:id */}
      <Link
        to={`/herbs/${item.id}`}
        className={
          "group flex h-full flex-col rounded-xl border bg-card p-4 pr-9 transition-all hover:shadow-md " +
          (selected
            ? "border-tcm-jade bg-tcm-jade/5 ring-1 ring-tcm-jade/30"
            : "border-border hover:border-tcm-jade/60")
        }
      >
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-lg font-semibold text-tcm-ink group-hover:text-tcm-jade">{item.title}</span>
          {item.pinyin && <span className="text-xs text-tcm-jade/80">{item.pinyin}</span>}
        </div>
        {item.gongneng && (
          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-foreground/70">{item.gongneng}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <FlaskConical className="h-3.5 w-3.5 shrink-0 text-tcm-jade/70" />
            <span><span className="text-tcm-jade">性味</span>　{item.subtitle || "未详"}</span>
          </span>
          {item.meridian && (
            <span className="inline-flex items-center gap-1">
              <Compass className="h-3.5 w-3.5 shrink-0 text-tcm-gold/70" />
              <span><span className="text-tcm-gold">归经</span>　{item.meridian}</span>
            </span>
          )}
        </div>
      </Link>
      <CheckboxButton
        keyId={keyOf(item)}
        index={index}
        selected={selected}
        onToggle={onToggle}
        title={selected ? "取消选择（Shift + 点击可连续多选）" : "选择卡片（Shift + 点击可连续多选）"}
      />
    </div>
  );
}

// ===== 组合卡片（可勾选、可展开来源、可拆分还原）=====
function ComboCardView({
  card,
  index,
  selected,
  onToggle,
  expanded,
  onToggleExpand,
  onSplit,
}: {
  card: ComboCard;
  index: number;
  selected: boolean;
  onToggle: (key: string, index: number, shift: boolean) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onSplit: () => void;
}) {
  return (
    <div
      className={
        "relative flex h-full flex-col rounded-xl border-2 border-dashed p-4 pr-9 transition-colors " +
        (selected ? "border-tcm-gold bg-tcm-gold/10" : "border-tcm-gold/50 bg-tcm-gold/5")
      }
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-serif text-lg font-semibold text-tcm-ink">{card.title}</span>
        <span className="shrink-0 rounded-full bg-tcm-gold/15 px-2 py-0.5 text-xs font-medium text-tcm-gold">
          组合 · {card.sources.length} 味
        </span>
      </div>
      {card.gongneng && (
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-foreground/70">{card.gongneng}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <FlaskConical className="h-3.5 w-3.5 shrink-0 text-tcm-jade/70" />
          <span><span className="text-tcm-jade">性味</span>　{card.subtitle || "未详"}</span>
        </span>
        {card.meridian && (
          <span className="inline-flex items-center gap-1">
            <Compass className="h-3.5 w-3.5 shrink-0 text-tcm-gold/70" />
            <span><span className="text-tcm-gold">归经</span>　{card.meridian}</span>
          </span>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          onClick={onToggleExpand}
          className="inline-flex items-center gap-1 rounded-md border border-tcm-gold/40 px-2 py-1 text-xs text-tcm-gold transition-colors hover:bg-tcm-gold/10"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "收起来源" : `查看 ${card.sources.length} 个来源`}
        </button>
        <button
          onClick={onSplit}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-tcm-cinnabar/50 hover:text-tcm-cinnabar"
          title="拆分后子卡片会重新出现在列表中"
        >
          <Split className="h-3 w-3" /> 拆分还原
        </button>
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.ul
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="mt-2 overflow-hidden border-t border-tcm-gold/30 pt-1 text-xs"
          >
            {card.sources.map((s) => (
              <li key={String(s.id)} className="flex items-center justify-between gap-2 border-b border-border/60 py-1 last:border-b-0">
                {/* 详情为整页路由：跳转 /herbs/:id */}
                <Link to={`/herbs/${s.id}`} className="shrink-0 text-foreground/85 transition-colors hover:text-tcm-jade">
                  {s.title}
                  {s.pinyin && <span className="ml-1 text-tcm-jade/70">{s.pinyin}</span>}
                </Link>
                <span className="truncate text-right text-muted-foreground">
                  {s.subtitle || "性味未详"}
                  {s.meridian ? ` · 归${s.meridian}` : ""}
                </span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      <CheckboxButton
        keyId={keyOf(card)}
        index={index}
        selected={selected}
        onToggle={onToggle}
        title={selected ? "取消选择该组合" : "选择该组合（可与其他卡片再次合并）"}
      />
    </div>
  );
}

// 勾选框：独立于卡片主体，点击不会触发卡片跳转
function CheckboxButton({
  keyId,
  index,
  selected,
  onToggle,
  title,
}: {
  keyId: string;
  index: number;
  selected: boolean;
  onToggle: (key: string, index: number, shift: boolean) => void;
  title: string;
}) {
  return (
    <button
      type="button"
      aria-label={selected ? "取消选择" : "选择卡片"}
      aria-pressed={selected}
      title={title}
      onClick={(e) => onToggle(keyId, index, e.shiftKey)}
      className={
        "absolute right-2.5 top-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-md border transition-colors " +
        (selected
          ? "border-tcm-jade bg-tcm-jade text-white"
          : "border-border bg-card/95 text-muted-foreground/50 hover:border-tcm-jade/60 hover:text-tcm-jade")
      }
    >
      {selected ? <Check className="h-3.5 w-3.5" /> : <Square className="h-3 w-3" />}
    </button>
  );
}

// ===== 四性 × 五味 聚合视图 =====
// 行=四气，列=五味，单元格为该性味组合下的药材数。
// 交互：点单元格→按“四气+五味”交叉筛选并跳回列表；点行/列头→仅按该维度筛选。
function NatureFlavorView({
  matrix,
  loading,
  activeNature,
  activeFlavor,
  onCrossFilter,
}: {
  matrix: NatureFlavorMatrix | null;
  loading: boolean;
  activeNature: string;
  activeFlavor: string;
  onCrossFilter: (natureVal: string, flavorVal: string) => void;
}) {
  if (loading || !matrix) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const { natures, flavors, cells, rowTotals, colTotals, total } = matrix;

  return (
    <div className="space-y-4">
      {/* 汇总统计 */}
      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <span className="text-xs text-muted-foreground">药材总数</span>
            <div className="font-serif text-2xl font-bold text-tcm-ink">{total}</div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {natures.map((n) => (
              <button
                key={n}
                onClick={() => onCrossFilter(n, "")}
                className="text-left transition-colors hover:text-tcm-jade"
              >
                <span className="text-xs text-muted-foreground">{n}性</span>
                <div className={"text-sm font-semibold " + (activeNature === n ? "text-tcm-jade" : "text-foreground/80")}>
                  {rowTotals[n] ?? 0}
                </div>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {flavors.map((f) => (
              <button
                key={f}
                onClick={() => onCrossFilter("", f)}
                className="text-left transition-colors hover:text-tcm-cinnabar"
              >
                <span className="text-xs text-muted-foreground">{f}味</span>
                <div className={"text-sm font-semibold " + (activeFlavor === f ? "text-tcm-cinnabar" : "text-foreground/80")}>
                  {colTotals[f] ?? 0}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 交叉矩阵 */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                四气 ＼ 五味
              </th>
              {flavors.map((f) => (
                <th key={f} className="border-b border-border px-3 py-2 text-center">
                  <button
                    onClick={() => onCrossFilter("", f)}
                    className={
                      "rounded px-1.5 py-0.5 font-medium transition-colors hover:bg-tcm-cinnabar/10 hover:text-tcm-cinnabar " +
                      (activeFlavor === f ? "text-tcm-cinnabar" : "text-foreground/80")
                    }
                  >
                    {f}
                  </button>
                </th>
              ))}
              <th className="border-b border-l border-border px-3 py-2 text-center text-xs font-medium text-tcm-gold">
                合计
              </th>
            </tr>
          </thead>
          <tbody>
            {natures.map((n) => (
              <tr key={n} className="border-b border-border last:border-b-0">
                <th className="sticky left-0 z-10 border-r border-border bg-card px-3 py-2 text-left">
                  <button
                    onClick={() => onCrossFilter(n, "")}
                    className={
                      "rounded px-1.5 py-0.5 font-medium transition-colors hover:bg-tcm-jade/10 hover:text-tcm-jade " +
                      (activeNature === n ? "text-tcm-jade" : "text-foreground/80")
                    }
                  >
                    {n}
                  </button>
                </th>
                {flavors.map((f) => {
                  const c = cells[`${n}|${f}`] ?? 0;
                  const isActive = activeNature === n && activeFlavor === f;
                  return (
                    <td key={f} className="border-border px-1 py-1 text-center">
                      <button
                        disabled={c === 0}
                        onClick={() => onCrossFilter(n, f)}
                        className={
                          "w-full rounded-md px-2 py-1.5 text-xs tabular-nums transition-colors " +
                          (c === 0
                            ? "cursor-not-allowed text-muted-foreground/40"
                            : isActive
                              ? "bg-tcm-jade/15 font-semibold text-tcm-jade"
                              : "text-foreground/80 hover:bg-tcm-jade/10 hover:text-tcm-jade")
                        }
                        title={c === 0 ? "无匹配药材" : `查看「${n}性 · ${f}味」的 ${c} 味药材`}
                      >
                        {c || "—"}
                      </button>
                    </td>
                  );
                })}
                <td className="border-l border-border px-3 py-2 text-center">
                  <button
                    onClick={() => onCrossFilter(n, "")}
                    className="rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums text-tcm-gold transition-colors hover:bg-tcm-gold/10"
                  >
                    {rowTotals[n] ?? 0}
                  </button>
                </td>
              </tr>
            ))}
            {/* 列合计 */}
            <tr className="bg-muted/30">
              <th className="sticky left-0 z-10 border-r border-border bg-muted/40 px-3 py-2 text-left text-xs font-medium text-tcm-gold">
                合计
              </th>
              {flavors.map((f) => (
                <td key={f} className="px-3 py-2 text-center">
                  <button
                    onClick={() => onCrossFilter("", f)}
                    className="rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums text-tcm-gold transition-colors hover:bg-tcm-gold/10"
                  >
                    {colTotals[f] ?? 0}
                  </button>
                </td>
              ))}
              <td className="border-l border-border px-3 py-2 text-center text-xs font-bold tabular-nums text-tcm-gold">
                {total}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        说明：四气为单值分类；五味可并存（如“甘、微苦”同时计入甘与苦），故各列合计之和大于药材总数。
        “其他”指性味中不含辛甘酸苦咸（如仅淡、涩或未标注）。点击单元格可按性味交叉筛选并跳回列表。
      </p>
    </div>
  );
}
