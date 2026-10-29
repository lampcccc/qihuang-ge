// 卡片多选 / 合并（卡片组合）的纯逻辑层：
// 与 UI 解耦，便于单独调整合并规则；字段规则集中在 buildCombo 中。
import type { HerbItem } from "./types";

// 合并后原卡片的处理方式：remove=移除（仅撤销/拆分可恢复），archive=归档（归档区可单独还原）
export type HiddenMode = "remove" | "archive";

// 组合卡片内保存的子卡片快照（展开查看来源 / 拆分还原时用得上）
export interface ComboSource {
  id: string | number;
  title: string;
  pinyin?: string;
  subtitle?: string;
  meridian?: string;
  gongneng?: string;
}

// 组合卡片：结构与普通卡片一致（可参与勾选、排序、计数），额外带 sources
export interface ComboCard {
  id: string;
  combo: true;
  title: string; // 以主卡为准
  pinyin: string;
  subtitle: string; // 性味：去重合并
  meridian: string; // 归经：去重合并
  gongneng: string; // 正文：按句去重合并
  sources: ComboSource[]; // 子卡片（主卡排在最前）
  createdAt: number;
}

export interface HiddenEntry {
  title: string;
  mode: HiddenMode;
}

// 被合并掉的原始卡片：id -> { 标题, 处理方式 }
export type HiddenMap = Record<string, HiddenEntry>;

// 撤销用的状态快照（合并 / 拆分 / 归档还原前的完整状态）
export interface MergeSnapshot {
  combos: ComboCard[];
  hidden: HiddenMap;
}

export interface HistoryEntry {
  label: string;
  at: number;
  snapshot: MergeSnapshot;
}

export interface MergeState {
  combos: ComboCard[];
  hidden: HiddenMap;
  history: HistoryEntry[];
}

export type Card = HerbItem | ComboCard;

const LS_PREFIX = "tcm:card-merge:";
const HISTORY_LIMIT = 20;

export const keyOf = (c: { id: string | number }) => String(c.id);

export function isCombo(c: Card): c is ComboCard {
  return (c as ComboCard).combo === true;
}

// 按分隔符切分（性味/归经常以 "辛、甘，温" 形式出现）
const TOKEN_SEP = /[、,，;；。.!！?？:：\s/·]+/;
function tokens(text: string): string[] {
  return text.split(TOKEN_SEP).map((s) => s.trim()).filter(Boolean);
}

// 逐字符切句，保留句末标点；不用 lookbehind 以保证兼容性
function sentences(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const ch of text) {
    buf += ch;
    if ("。；;！!？?".includes(ch)) {
      out.push(buf);
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

// 四气 / 五味关键字：性味字段常夹杂“叶：… 花：…”等药用部位前缀，需按关键字过滤
const XINGWEI_CHARS = /[温热寒凉平辛甘酸苦咸淡涩]/;
// 归经关键字：源库归经形如“肝、肾经”“归肺、胃经”
const GUIJING_CHARS = /[经心肝脾肺肾胃胆膀胱三焦小大肠]/;

// 短语/标签类字段合并：切分后去重（忽略 味/性 前缀差异），keep 用于剔除无关片段，并按长度截断
export function mergeTokens(values: string[], keep?: RegExp, maxLen = 48): string {
  const all: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    for (const seg of tokens(v || "")) {
      // 统一去掉 味/性 前缀，保证“辛”与“味辛”视为同一味
      const k = seg.replace(/^(味|性)/, "");
      if (!k || seen.has(k)) continue;
      seen.add(k);
      all.push(k);
    }
  }
  // 过滤后为空说明格式超出预期，退回未过滤结果，避免丢信息
  let list = all;
  if (keep) {
    const f = all.filter((s) => keep.test(s.replace(/^(味|性)/, "")));
    if (f.length) list = f;
  }
  let text = list.join("、");
  if (text.length > maxLen) {
    const cut: string[] = [];
    let len = 0;
    for (const s of list) {
      if (len + s.length + 1 > maxLen) break;
      cut.push(s);
      len += s.length + 1;
    }
    text = cut.join("、") + "…";
  }
  return text;
}

// 正文类字段合并：按句去重后拼接，避免整段重复叠加
export function mergeSentences(values: string[], maxLen = 600): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    for (const s of sentences(v || "")) {
      if (s.length < 2) continue;
      const k = s.replace(/\s+/g, "");
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
  }
  const text = out.join("");
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

function toSource(c: Card): ComboSource {
  return {
    id: c.id,
    title: c.title,
    pinyin: c.pinyin || "",
    subtitle: c.subtitle || "",
    meridian: c.meridian || "",
    gongneng: c.gongneng || "",
  };
}

// 选中项展开为子卡片列表：组合卡片摊平（避免嵌套叠加），并按 id 去重
export function flattenCards(cards: Card[]): { sources: ComboSource[]; comboIds: string[] } {
  const sources: ComboSource[] = [];
  const comboIds: string[] = [];
  const seen = new Set<string>();
  for (const c of cards) {
    if (isCombo(c)) {
      comboIds.push(keyOf(c));
      for (const s of c.sources) {
        const k = String(s.id);
        if (seen.has(k)) continue;
        seen.add(k);
        sources.push(s);
      }
    } else {
      const k = keyOf(c);
      if (seen.has(k)) continue;
      seen.add(k);
      sources.push(toSource(c));
    }
  }
  return { sources, comboIds };
}

// 生成组合卡片：标题/拼音以主卡为准，性味、归经、功效去重合并
export function buildCombo(sources: ComboSource[], primaryId: string): ComboCard {
  const primary = sources.find((s) => String(s.id) === primaryId) ?? sources[0];
  // 以解析出的主卡 id 过滤，避免主卡 id 不在源列表时把主卡重复排进列表
  const pId = primary ? String(primary.id) : "";
  const ordered = primary ? [primary, ...sources.filter((s) => String(s.id) !== pId)] : sources;
  return {
    id: `combo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    combo: true,
    title: primary?.title ?? "组合卡片",
    pinyin: primary?.pinyin ?? "",
    subtitle: mergeTokens(ordered.map((s) => s.subtitle || ""), XINGWEI_CHARS),
    meridian: mergeTokens(ordered.map((s) => s.meridian || ""), GUIJING_CHARS),
    gongneng: mergeSentences(ordered.map((s) => s.gongneng || "")),
    sources: ordered,
    createdAt: Date.now(),
  };
}

// 从组合中移出若干子卡片（归档还原时用）：剩余不足 2 张则整个组合解散
// 返回需要还原的卡片 id（含被解散组合的剩余子卡片），保证计数不重复
export function pruneCombos(
  combos: ComboCard[],
  removeIds: Set<string>
): { combos: ComboCard[]; dissolvedIds: string[]; removedComboIds: string[] } {
  const kept: ComboCard[] = [];
  const dissolvedIds: string[] = [];
  const removedComboIds: string[] = [];
  for (const c of combos) {
    const rest = c.sources.filter((s) => !removeIds.has(String(s.id)));
    if (rest.length === c.sources.length) {
      kept.push(c);
      continue;
    }
    removedComboIds.push(c.id);
    if (rest.length < 2) {
      // 组合至少保留 2 张，否则解散并还原其余子卡片
      dissolvedIds.push(...rest.map((s) => String(s.id)));
      continue;
    }
    // 移出后重新合并（主卡可能随之变化），保持组合 id 与创建时间不变
    kept.push({ ...buildCombo(rest, String(rest[0].id)), id: c.id, createdAt: c.createdAt });
  }
  return { combos: kept, dissolvedIds, removedComboIds };
}

// 合并前置校验：仅选 1 张、去重后不足 2 张均不可合并
export function validateMerge(picked: Card[]): { ok: boolean; reason: string } {
  if (picked.length < 2) return { ok: false, reason: "合并至少需要 2 张卡片，请再选择 1 张" };
  const { sources } = flattenCards(picked);
  if (sources.length < 2) return { ok: false, reason: "选中卡片去重后不足 2 张，无法合并" };
  return { ok: true, reason: "" };
}

// ===== 本地持久化（组合卡片 / 已合并原卡片 / 撤销历史）=====
export function loadMergeState(scope: string): MergeState {
  const empty: MergeState = { combos: [], hidden: {}, history: [] };
  try {
    const raw = localStorage.getItem(LS_PREFIX + scope);
    if (!raw) return empty;
    const p = JSON.parse(raw) as Partial<MergeState>;
    return {
      combos: Array.isArray(p.combos) ? p.combos : [],
      hidden: p.hidden && typeof p.hidden === "object" ? p.hidden : {},
      history: Array.isArray(p.history) ? p.history.slice(-HISTORY_LIMIT) : [],
    };
  } catch {
    return empty;
  }
}

export function saveMergeState(scope: string, s: MergeState) {
  try {
    localStorage.setItem(
      LS_PREFIX + scope,
      JSON.stringify({ combos: s.combos, hidden: s.hidden, history: s.history.slice(-HISTORY_LIMIT) })
    );
  } catch {
    // 隐私模式 / 空间不足时静默降级为仅本次会话有效
  }
}

export function pushHistoryEntry(h: HistoryEntry[], label: string, snapshot: MergeSnapshot): HistoryEntry[] {
  return [...h, { label, at: Date.now(), snapshot }].slice(-HISTORY_LIMIT);
}
