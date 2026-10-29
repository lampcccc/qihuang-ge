/**
 * 数据标注管线（离线一次性脚本）
 * ------------------------------------------------------------------
 * 用途：把 SQLite 原始文本字段抽取为结构化标签，产出 data/annotations/*.json，
 *       供后端接口与前端筛选/聚合消费。可重复执行（幂等覆盖）。
 *
 * 运行：bun run annotate   （或 bun run server/annotate.ts）
 *
 * 产出：
 *   1. data_profile.json      —— 数据画像：各表规模、字段填充率、实体类别分布、质量指标
 *   2. entity_categories.json —— 实体类别标注口径（TypeID → 类别名）
 *   3. herb_attributes.json   —— 药材结构化属性（四气/五味[]/归经[]/毒性/功效分类）
 *   4. book_annotations.json  —— 典籍标注（书名 + 典籍类别 + 章节数）
 *
 * 标注口径说明（重要）：
 *   - 实体类别以源库 TypeID 为准，这是数据自带的可靠分类，优于按标题关键词猜测。
 *   - 五味/归经为多值标签（一味药可同时有辛与苦、归多经），故为数组。
 *   - 功效分类按《中药学》21 类，由“功能主治”文本关键词打分取最高分类兜底为“其他”。
 */
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { detectEffect } from "./effect";

const DB_PATH = join(import.meta.dir, "..", "data", "zysj.sqlite");
const OUT_DIR = join(import.meta.dir, "..", "data", "annotations");
mkdirSync(OUT_DIR, { recursive: true });

const db = new Database(DB_PATH, { readonly: true });

// ============ 基础工具 ============
function decode(s: any): string {
  if (s == null) return "";
  let t = String(s);
  t = t
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; }
    })
    .replace(/&#(\d+);/g, (_, d: string) => {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch { return _; }
    })
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
  return t.replace(/\[b\]|\[\/b\]|\[p\]|\[\/p\]/g, "").trim();
}
const has = (s: string, kw: string) => s.includes(kw);

// ============ 1. 实体类别口径（以 TypeID 为准，非关键词猜测）============
// zysjyj：药材 / 方剂 / 其他
const YJ_TYPES: Record<number, { name: string; note: string }> = {
  40: { name: "中药材", note: "单味药材条目，含性味、归经、功能主治" },
  39: { name: "方剂", note: "成方/中成药条目，以功效主治为主，多无性味" },
  84: { name: "其他制剂", note: "少量特殊制剂条目" },
};
// zysjzhsj：医案 / 科普 / 资讯 / 防病 / 行政 / 杂项
// 注：TypeID=7 为源库中真正的医案（如张锡纯医案），此前按标题正则划分会漏判 87%、误判 79%。
const ZHSJ_TYPES: Record<number, { name: string; note: string }> = {
  7: { name: "医案", note: "历代医家临证医案原文" },
  9: { name: "医学科普", note: "中药知识、炮制、用法等科普文章" },
  1020: { name: "行业资讯", note: "中医药管理局通知、行业动态" },
  0: { name: "养生防病", note: "四季养生与疾病预防科普" },
  1018: { name: "行政文件", note: "药品管理、标准类行政公文" },
  83: { name: "病案片段", note: "短篇病例记录" },
  1031: { name: "站点杂项", note: "站点说明、留言等非医药内容" },
  33: { name: "图片集", note: "照片类资源" },
  34: { name: "图片集", note: "照片类资源" },
};

// ============ 2. 药材属性标注 ============
const NATURES = ["温", "热", "寒", "凉", "平"] as const;
const FLAVORS = ["辛", "甘", "酸", "苦", "咸"] as const;
// 归经：注意「心包」包含「心」，须先匹配长的再匹配短的
const MERIDIANS = ["心包", "三焦", "大肠", "小肠", "膀胱", "肺", "胃", "脾", "心", "肾", "胆", "肝"];

function detectNature(xw: string): string {
  // 与后端 NATURE_CASE 保持一致：大热/热 → 热，其次 寒/凉/温/平
  if (has(xw, "大热") || has(xw, "热")) return "热";
  if (has(xw, "寒")) return "寒";
  if (has(xw, "凉")) return "凉";
  if (has(xw, "温")) return "温";
  if (has(xw, "平")) return "平";
  return "其他";
}
function detectFlavors(xw: string): string[] {
  return FLAVORS.filter((f) => has(xw, f));
}
// 六经（三阴三阳）→ 十二经映射。源库部分归经沿用古籍表述，如“入足厥阴经”“入手足太阴、阳明经”，
// 直接匹配十二经名会漏标，故先按十二经名匹配，未命中再按六经展开。
const SIX_MERIDIAN_MAP: Record<string, { 手: string[]; 足: string[]; both: string[] }> = {
  太阳: { 手: ["小肠"], 足: ["膀胱"], both: ["小肠", "膀胱"] },
  阳明: { 手: ["大肠"], 足: ["胃"], both: ["大肠", "胃"] },
  少阳: { 手: ["三焦"], 足: ["胆"], both: ["三焦", "胆"] },
  太阴: { 手: ["肺"], 足: ["脾"], both: ["肺", "脾"] },
  少阴: { 手: ["心"], 足: ["肾"], both: ["心", "肾"] },
  厥阴: { 手: ["心包"], 足: ["肝"], both: ["心包", "肝"] },
};
function detectMeridians(gj: string): string[] {
  if (!gj) return [];
  const found: string[] = [];
  let rest = gj;
  for (const m of MERIDIANS) {
    if (has(rest, m)) {
      found.push(m);
      rest = rest.split(m).join(""); // 移除已匹配项，避免「心包」再被计为「心」
    }
  }
  if (found.length > 0) return [...new Set(found)];

  // ② 六经表述：如「足厥阴」「手太阴」「手足太阴、阳明」
  for (const [six, map] of Object.entries(SIX_MERIDIAN_MAP)) {
    if (!has(rest, six)) continue;
    // 判定该六经前是否有「手」「足」限定（取紧邻前文）
    const idx = rest.indexOf(six);
    const prefix = rest.slice(Math.max(0, idx - 3), idx);
    if (prefix.includes("手") && prefix.includes("足")) found.push(...map.both);
    else if (prefix.includes("手")) found.push(...map.手);
    else if (prefix.includes("足")) found.push(...map.足);
    else found.push(...map.both);
    rest = rest.split(six).join("·");
  }
  // ③ 三阴/三阳简称：如「足三阴经」
  if (found.length === 0) {
    if (has(rest, "足三阴")) found.push("脾", "肾", "肝");
    else if (has(rest, "足三阳")) found.push("胃", "膀胱", "胆");
    else if (has(rest, "手三阴")) found.push("肺", "心", "心包");
    else if (has(rest, "手三阳")) found.push("大肠", "小肠", "三焦");
  }
  // ④ 命门、髀等古称无法归入十二经，标注为“其他经”以便与“未标注”区分
  if (found.length === 0 && gj.length > 0) return ["其他经"];
  return [...new Set(found)];
}
function detectToxicity(dx: string): string {
  if (!dx) return "未标注";
  if (has(dx, "大毒")) return "大毒";
  if (has(dx, "小毒")) return "有小毒";
  if (has(dx, "毒")) return "有毒";
  return "无毒";
}

// 《中药学》功效分类（21 类）与 detectEffect 已抽到 ./effect.ts（汤方模块复用同一套规则），
// 避免两处词典各自演进导致药材与汤方的功效口径不一致。

// ============ 3. 典籍类别（由章节标题关键词推断）============
const BOOK_CAT_RULES: [RegExp, string][] = [
  [/本草|药性|药物|汤液/, "本草类"],
  [/医案|验案|治验|医话/, "医案医话类"],
  [/针灸|腧穴|俞穴|经络|灸法/, "针灸类"],
  [/伤寒|温病|金匮|六经/, "伤寒温病类"],
  [/妇人|经闭|胎|产|种子|女科/, "妇科类"],
  [/小儿|幼科|儿科/, "儿科类"],
  [/眼|目疾/, "眼科类"],
  [/喉|齿|口疮/, "喉齿类"],
  [/疮|痈|疽|伤科|正骨|接骨/, "外科伤科类"],
  [/养生|食疗|食养|寿|导引/, "养生食疗类"],
  [/脉|诊法|舌诊/, "诊法类"],
  [/方|汤|丸|散|丹|剂/, "方书类"],
  [/虚劳|肿胀|痰饮|内科/, "内科类"],
];
function detectBookCategory(titles: string): string {
  for (const [re, name] of BOOK_CAT_RULES) if (re.test(titles)) return name;
  return "综合类";
}

// ============ 执行：数据画像 ============
console.log("[annotate] 开始数据画像…");
const profile: any = { generatedAt: new Date().toISOString(), tables: {} };

function profileTable(table: string) {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as any[];
  const total = (db.query(`SELECT COUNT(*) c FROM ${table}`).get() as any).c;
  const exprs = cols.map(
    (c) => `SUM(CASE WHEN \`${c.name}\` IS NOT NULL AND TRIM(CAST(\`${c.name}\` AS TEXT)) <> '' THEN 1 ELSE 0 END) AS \`${c.name}\``
  );
  const row = db.query(`SELECT ${exprs.join(", ")} FROM ${table}`).get() as any;
  const columns = cols.map((c) => ({
    name: c.name,
    type: c.type,
    filled: Number(row[c.name] ?? 0),
    fillRate: total ? +((Number(row[c.name] ?? 0) / total) * 100).toFixed(1) : 0,
  }));
  const typeDist = db.query(`SELECT TypeID, COUNT(*) c FROM ${table} GROUP BY TypeID ORDER BY c DESC`).all() as any[];
  return { total, columns, typeDist };
}

for (const t of ["zysjyj", "zysjllsj", "zysjzhsj"]) {
  const p = profileTable(t);
  const typeMap = t === "zysjyj" ? YJ_TYPES : t === "zysjzhsj" ? ZHSJ_TYPES : {};
  p.typeDist = p.typeDist.map((r: any) => ({
    typeId: r.TypeID,
    count: r.c,
    label: (typeMap as any)[r.TypeID]?.name ?? (t === "zysjllsj" ? `典籍#${r.TypeID}` : `未知(${r.TypeID})`),
  }));
  profile.tables[t] = p;
  console.log(`  ${t}: ${p.total} 行，${p.columns.length} 列`);
}

// ============ 执行：实体类别标注 ============
console.log("[annotate] 标注实体类别…");
const entityCategories = {
  note: "以源库 TypeID 为准的实体类别口径；zysjllsj 的 TypeID 为书号，书名见 book_annotations.json",
  zysjyj: YJ_TYPES,
  zysjzhsj: ZHSJ_TYPES,
  zysjllsj: { note: "TypeID = 典籍编号（共 989 部），书名与类别见 book_annotations.json" },
};

// ============ 执行：药材属性标注 ============
console.log("[annotate] 标注药材属性…");
const herbRows = db
  .query(`SELECT ID, MingCheng, TypeID, XingWei, GuiJing, GongNengZZ, DuXing, ChuChu FROM zysjyj WHERE TypeID = 40`)
  .all() as any[];

const herbAttrs: Record<string, any> = {};
const agg = {
  nature: {} as Record<string, number>,
  flavor: {} as Record<string, number>,
  meridian: {} as Record<string, number>,
  toxicity: {} as Record<string, number>,
  effect: {} as Record<string, number>,
  effectConfidence: {} as Record<string, number>,
};
const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

let qualitySum = 0;
for (const r of herbRows) {
  const xw = decode(r.XingWei);
  const gj = decode(r.GuiJing);
  const gn = decode(r.GongNengZZ);
  const dx = decode(r.DuXing);
  const nature = detectNature(xw);
  const flavors = detectFlavors(xw);
  const meridians = detectMeridians(gj);
  const toxicity = detectToxicity(dx);
  const eff = detectEffect(gn);
  const effect = eff.effect;

  // 完整度：关键字段填充比例（性味/归经/功能主治/用法用量/出处）
  const filled = [xw, gj, gn, dx, decode(r.ChuChu)].filter((s) => s.length > 0).length;
  const completeness = +(filled / 5).toFixed(2);
  qualitySum += completeness;

  herbAttrs[String(r.ID)] = {
    name: decode(r.MingCheng),
    nature,
    flavors,
    meridians,
    toxicity,
    effect,
    effectConfidence: eff.confidence,
    hasXingWei: !!xw,
    hasGuiJing: !!gj,
    completeness,
  };
  bump(agg.nature, nature);
  flavors.forEach((f) => bump(agg.flavor, f));
  // 有性味文本但不含标准五味 → 其他；无性味文本 → 未标注（与后端 facet 口径区分开）
  if (flavors.length === 0) bump(agg.flavor, xw ? "其他" : "未标注");
  meridians.forEach((m) => bump(agg.meridian, m));
  if (meridians.length === 0) bump(agg.meridian, "未标注");
  bump(agg.toxicity, toxicity);
  bump(agg.effect, effect);
  bump(agg.effectConfidence, eff.confidence);
}
console.log(`  药材属性标注完成：${herbRows.length} 味`);

// ============ 执行：典籍标注 ============
console.log("[annotate] 标注典籍信息…");
let bookTitles: Record<string, any> = {};
try {
  bookTitles = JSON.parse(readFileSync(join(import.meta.dir, "..", "data", "book_titles.json"), "utf8"));
} catch {
  console.warn("  [warn] 未找到 book_titles.json，典籍书名将回退为编号");
}
// 一次性取全部章节标题，按书分组后推断类别（避免逐书查询）
const chapterRows = db.query(`SELECT TypeID, BiaoTi FROM zysjllsj`).all() as any[];
const bookTitleBlob = new Map<number, string[]>();
for (const r of chapterRows) {
  const t = decode(r.BiaoTi);
  if (!bookTitleBlob.has(r.TypeID)) bookTitleBlob.set(r.TypeID, []);
  if (t) bookTitleBlob.get(r.TypeID)!.push(t);
}
const bookAnnotations: Record<string, any> = {};
let bookCatCount: Record<string, number> = {};
for (const [tid, titles] of bookTitleBlob) {
  const meta = bookTitles[String(tid)];
  const blob = titles.slice(0, 40).join(" "); // 取前 40 个章节标题推断类别，避免全量拼接
  const category = detectBookCategory(blob);
  bookAnnotations[String(tid)] = {
    title: meta?.title ?? `典籍 #${tid}`,
    method: meta?.method ?? "unknown",
    author: meta?.author ?? null,
    era: meta?.era ?? null,
    category,
    chapterCount: titles.length,
  };
  bookCatCount[category] = (bookCatCount[category] ?? 0) + 1;
}
console.log(`  典籍标注完成：${bookTitleBlob.size} 部`);

// ============ 汇总质量指标 ============
profile.quality = {
  herbCount: herbRows.length,
  herbAvgCompleteness: +(qualitySum / Math.max(herbRows.length, 1)).toFixed(3),
  missingXingWei: herbRows.filter((r) => !decode(r.XingWei)).length,
  missingGuiJing: herbRows.filter((r) => !decode(r.GuiJing)).length,
};
profile.aggregations = { herb: agg, bookCategory: bookCatCount };

// ============ 写盘 ============
writeFileSync(join(OUT_DIR, "data_profile.json"), JSON.stringify(profile, null, 2));
writeFileSync(join(OUT_DIR, "entity_categories.json"), JSON.stringify(entityCategories, null, 2));
writeFileSync(join(OUT_DIR, "herb_attributes.json"), JSON.stringify(herbAttrs, null, 2));
writeFileSync(join(OUT_DIR, "book_annotations.json"), JSON.stringify(bookAnnotations, null, 2));

// ============ 输出摘要 ============
const top = (m: Record<string, number>, n = 8) =>
  Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join("  ");
console.log("\n══════════ 标注结果摘要 ══════════");
console.log(`药材总数        ${herbRows.length}`);
console.log(`四气分布        ${top(agg.nature, 6)}`);
console.log(`五味分布        ${top(agg.flavor, 6)}`);
console.log(`归经分布        ${top(agg.meridian, 12)}`);
console.log(`毒性分布        ${top(agg.toxicity, 5)}`);
console.log(`功效分类        ${top(agg.effect, 21)}`);
console.log(`功效置信度      ${top(agg.effectConfidence, 4)}`);
console.log(`典籍类别        ${top(bookCatCount, 13)}`);
console.log(`平均完整度      ${profile.quality.herbAvgCompleteness}  (缺性味 ${profile.quality.missingXingWei}, 缺归经 ${profile.quality.missingGuiJing})`);
console.log(`\n产出目录 ${OUT_DIR}`);
console.log("  data_profile.json / entity_categories.json / herb_attributes.json / book_annotations.json");
