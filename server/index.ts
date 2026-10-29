import { serve } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dbAlive, queryRows, queryOne } from "./db";
import { cached } from "./cache";
import {
  listPrescriptions, getPrescription, createPrescription, updatePrescription,
  deletePrescription, restorePrescription, resetPrescription, validateRx, rxStats,
  herbRelatedRx, homeRxSection,
} from "./prescriptions";

// 汤方写入版本号：任何增改删都会递增，并作为列表缓存键的一部分使其失效
let rxVersion = 0;

// 解析 JSON 请求体（失败返回 null）
async function readJson(req: Request): Promise<any | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
import {
  MODULES,
  REAL_MODULE_KEYS,
  HERB_FIELD_GROUPS,
  GLOSSARY,
  TEXTBOOKS,
  EXAM_RESOURCES,
  MANUAL_SECTIONS,
} from "./data";

// 端口：默认 3801。注：Windows 上 3001 常落入系统动态“排除端口范围”（Hyper-V/WSL 预留），
// 会导致 listen 抛 EADDRINUSE（netstat 看不到占用进程）。故默认端口避开该区段，
// 并在被占用时自动顺延到候选端口，避免服务因端口被系统保留而启动失败。
const PREFERRED_PORT = Number(Bun.env.PORT || 3801);
const PORT_FALLBACKS = [3801, 3901, 4001, 4101, 4201, 4301];
if (!PORT_FALLBACKS.includes(PREFERRED_PORT)) PORT_FALLBACKS.unshift(PREFERRED_PORT);
const PAGE_SIZE = 18;

// 中药材专用表与筛选条件（TypeID=40 为中药材，39 为方剂，84 为其他）
const HERB_TABLE = "zysjyj";
const HERB_BASE = "TypeID = 40";

// 药材图片目录：把图片按 TuPian 中的文件名放进该目录即可自动生效（备份中不含图片实体文件）
const HERB_IMG_DIR = join(import.meta.dir, "..", "data", "herb_images");

// 图片缺失时的内联占位图（本草意象：叶片 + 留白），避免详情页出现破图
function placeholderSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#f2f7f2"/><stop offset="100%" stop-color="#e3efe4"/>
  </linearGradient></defs>
  <rect width="400" height="300" fill="url(#g)"/>
  <g fill="none" stroke="#5b8c5a" stroke-width="3" stroke-linecap="round" opacity="0.55">
    <path d="M200 240 C200 190 200 150 200 100"/>
    <path d="M200 170 C170 165 150 145 148 118 C178 116 198 138 200 170 Z"/>
    <path d="M200 150 C230 145 250 125 252 98 C222 96 202 118 200 150 Z"/>
    <path d="M200 205 C176 202 162 188 160 168 C184 166 198 183 200 205 Z"/>
    <path d="M200 205 C224 202 238 188 240 168 C216 166 202 183 200 205 Z"/>
  </g>
  <text x="200" y="272" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" fill="#7a8f7a">暂无药材图片</text>
</svg>`;
}

// 由“性味”文本派生“四气”分类（热/寒/凉/温/平/其他）
const NATURE_CASE = `CASE
  WHEN XingWei LIKE '%大热%' OR XingWei LIKE '%热%' THEN '热'
  WHEN XingWei LIKE '%寒%' THEN '寒'
  WHEN XingWei LIKE '%凉%' THEN '凉'
  WHEN XingWei LIKE '%温%' THEN '温'
  WHEN XingWei LIKE '%平%' THEN '平'
  ELSE '其他' END`;
// 四气标准顺序（用户指定：温 热 寒 凉 平），其余归为“其他”
const NATURE_STANDARD = ["温", "热", "寒", "凉", "平"];
// 五味标准（辛 甘 酸 苦 咸）；性味字段 XingWei 中五味可并存（如“甘、苦”），故按“是否含某味”分别统计
const FLAVOR_STANDARD = ["辛", "甘", "酸", "苦", "咸"];
const MERIDIANS = ["肺", "大肠", "胃", "脾", "心", "小肠", "膀胱", "肾", "心包", "三焦", "胆", "肝"];

// ===== 中医著作书名映射 =====
// 数据表 zysjllsj 仅有 TypeID（书编号），无书名列。book_titles.json 由离线脚本
// 从内容（古籍《》/简介标记、经典后缀、教材首章、作者朝代、主题兜底、类别兜底）还原，
// method 标记还原方式：override/bookmark/jianjie 为高置信书名，chapter/classic 为书名或经典名，
// author 为医家名，topic 为主题词，category 为类别标签。
interface BookMeta {
  title: string;
  method: string;
  author?: string | null;
  era?: string | null;
  count: number;
  first: string;
}
const BOOK_TITLES = new Map<number, BookMeta>();
try {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, "..", "data", "book_titles.json"), "utf8")) as Record<string, BookMeta>;
  for (const [k, v] of Object.entries(raw)) BOOK_TITLES.set(Number(k), v);
} catch (e) {
  console.warn("[tcm-server] 未能加载 book_titles.json：", e);
}

// ===== 数据标注（由离线脚本 server/annotate.ts 生成，可重复执行覆盖）=====
// 存放从原始文本中抽取的结构化标签：药材属性（四气/五味/归经/毒性/功效分类）、
// 数据画像（各表规模与字段填充率）、实体类别口径、典籍类别。
// 重新生成：bun run annotate
interface HerbAttr {
  name: string;
  nature: string;
  flavors: string[];
  meridians: string[];
  toxicity: string;
  effect: string;
  effectConfidence: string;
  completeness: number;
}
const HERB_ATTRS = new Map<number, HerbAttr>();
let DATA_PROFILE: any = null;
let ENTITY_CATEGORIES: any = null;
let BOOK_ANNOTATIONS: Record<string, any> | null = null;
function loadJsonAnnotation(file: string): any {
  try {
    return JSON.parse(readFileSync(join(import.meta.dir, "..", "data", "annotations", file), "utf8"));
  } catch {
    return null;
  }
}
try {
  const raw = loadJsonAnnotation("herb_attributes.json");
  if (raw) for (const [k, v] of Object.entries(raw)) HERB_ATTRS.set(Number(k), v as HerbAttr);
  DATA_PROFILE = loadJsonAnnotation("data_profile.json");
  ENTITY_CATEGORIES = loadJsonAnnotation("entity_categories.json");
  BOOK_ANNOTATIONS = loadJsonAnnotation("book_annotations.json");
  if (HERB_ATTRS.size) console.log(`[tcm-server] 已加载药材标注 ${HERB_ATTRS.size} 条`);
} catch (e) {
  console.warn("[tcm-server] 加载标注文件失败（不影响主流程）：", e);
}

// 汤方索引（由离线脚本 server/build_rx.ts 生成；为空时汤方列表无数据，需先跑脚本）
try {
  const st = rxStats();
  if (st.meta === 0) console.warn("[tcm-server] 汤方索引为空，请先运行：bun run server/build_rx.ts");
  else console.log(`[tcm-server] 已加载汤方索引 ${st.meta} 条（自建 ${st.metaCustom} / 组成 ${st.herbs} 行 / 关联药材 ${st.matched} 行）`);
} catch (e) {
  console.warn("[tcm-server] 读取汤方索引失败：", e);
}

function bookInfo(typeId: number): { title: string; author: string | null; era: string | null; method: string } {
  const m = BOOK_TITLES.get(typeId);
  if (!m) return { title: `典籍 #${typeId}`, author: null, era: null, method: "unknown" };
  return { title: m.title, author: m.author ?? null, era: m.era ?? null, method: m.method };
}

// 由 BM1~BM4 生成层级路径（篇/章/节，BM4 作为最细目一般省略以减少噪音）
function hierPath(b1: number, b2: number, b3: number, b4: number): string {
  void b4;
  const parts: string[] = [];
  if (b1 > 0) parts.push(`第${b1}篇`);
  if (b2 > 0) parts.push(`第${b2}章`);
  if (b3 > 0) parts.push(`第${b3}节`);
  return parts.join(" · ");
}

// 文本清洗工具已抽到 ./text.ts：汤方模块需复用，且 index.ts 会在模块加载时启动服务，
// 其他模块不能反向 import 它（会造成循环依赖并在导入时起服务）。
import { decodeEntities, excerpt, formatProse, escapeHtml } from "./text";

// 列表/搜索副标题 SQL：优先用自定义表达式（如著作的层级路径），其次用列，最后 NULL
function subtitleSql(cfg: typeof MODULES[string]): string {
  if (cfg.subtitleExpr) return `(${cfg.subtitleExpr}) AS subtitle`;
  if (cfg.subtitleCol) return `${cfg.subtitleCol} AS subtitle`;
  return "NULL AS subtitle";
}

async function moduleCount(key: string): Promise<number> {
  const cfg = MODULES[key];
  const where = cfg.filter ? `WHERE ${cfg.filter}` : "";
  const row = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${cfg.table} ${where}`);
  return row?.c ?? 0;
}

async function listModule(key: string, page: number, q?: string) {
  const cfg = MODULES[key];
  const like = q ? `%${q}%` : null;
  const colConds = cfg.searchCols.map((c) => `${c} LIKE ?`).join(" OR ");
  let where = cfg.filter ? `(${cfg.filter})` : "";
  const params: any[] = [];
  if (like) {
    const cond = `(${colConds})`;
    where = where ? `${where} AND ${cond}` : cond;
    params.push(...cfg.searchCols.map(() => like));
  }
  where = where ? `WHERE ${where}` : "";

  const totalRow = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM ${cfg.table} ${where}`,
    params
  );
  const total = totalRow?.c ?? 0;
  const offset = (page - 1) * PAGE_SIZE;

  // ③ 默认按模块 orderBy（著作为 TypeID,BM1,BM2,BM3,id）；④ 有搜索词时标题命中优先
  const orderBy = cfg.orderBy ?? "id";
  let orderClause = `ORDER BY ${orderBy}`;
  if (like) {
    orderClause = `ORDER BY (${cfg.titleCol} LIKE ?) DESC, ${orderBy}`;
    params.push(like);
  }

  const rows = await queryRows<Record<string, any>>(
    `SELECT ${cfg.idCol} AS id, ${cfg.titleCol} AS title, ${subtitleSql(cfg)} FROM ${cfg.table} ${where} ${orderClause} LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, offset]
  );
  const items = rows.map((r) => ({
    id: r.id,
    title: decodeEntities(r.title),
    subtitle: r.subtitle ? excerpt(r.subtitle, 40) : "",
  }));
  return { key, name: cfg.name, icon: cfg.icon, kind: cfg.kind, total, page, pageSize: PAGE_SIZE, items };
}

// 著作列表：按“书名”（TypeID）聚合，每本书一张卡片
async function listBooks(q: string | undefined, page: number) {
  let typeIds: number[];
  if (q) {
    const like = `%${q}%`;
    const titleHits = new Set<number>();
    for (const [tid, m] of BOOK_TITLES) {
      if (m.title.includes(q) || (m.author && m.author.includes(q))) titleHits.add(tid);
    }
    const chapterHits = (
      (await queryRows<{ TypeID: number }>(
        `SELECT DISTINCT TypeID FROM zysjllsj WHERE BiaoTi LIKE ? OR NeiRong LIKE ?`,
        [like, like]
      )) as any[]
    ).map((r) => r.TypeID);
    typeIds = [...new Set([...titleHits, ...chapterHits])].sort((a, b) => a - b);
  } else {
    typeIds = (
      (await queryRows<{ TypeID: number }>(`SELECT DISTINCT TypeID FROM zysjllsj ORDER BY TypeID`)) as any[]
    ).map((r) => r.TypeID);
  }
  const total = typeIds.length;
  const offset = (page - 1) * PAGE_SIZE;
  const pageIds = typeIds.slice(offset, offset + PAGE_SIZE);
  const items = pageIds.map((tid) => {
    const m = BOOK_TITLES.get(tid);
    const info = bookInfo(tid);
    return {
      typeId: tid,
      title: info.title,
      author: info.author,
      era: info.era,
      method: info.method,
      chapterCount: m ? m.count : 0,
      firstChapter: m ? excerpt(m.first, 40) : "",
    };
  });
  return {
    key: "works",
    name: MODULES.works.name,
    icon: MODULES.works.icon,
    kind: "book" as const,
    total,
    page,
    pageSize: PAGE_SIZE,
    items,
  };
}

// 单本书目录：返回该 TypeID 下按顺序排列的章节（可带书名内检索 q）
async function getBookToc(typeId: number, q?: string) {
  const info = bookInfo(typeId);
  let rows: any[];
  if (q) {
    const like = `%${q}%`;
    rows = await queryRows<any>(
      `SELECT ID, BiaoTi, BM1, BM2, BM3, BM4 FROM zysjllsj WHERE TypeID = ? AND (BiaoTi LIKE ? OR NeiRong LIKE ?) ORDER BY ID`,
      [typeId, like, like]
    );
  } else {
    rows = await queryRows<any>(
      `SELECT ID, BiaoTi, BM1, BM2, BM3, BM4 FROM zysjllsj WHERE TypeID = ? ORDER BY ID`,
      [typeId]
    );
  }
  const chapters = rows.map((r) => ({
    id: r.ID,
    title: decodeEntities(r.BiaoTi),
    path: hierPath(r.BM1, r.BM2, r.BM3, r.BM4),
  }));
  return {
    typeId,
    title: info.title,
    author: info.author,
    era: info.era,
    method: info.method,
    total: chapters.length,
    chapters,
  };
}

// 全站检索中的“著作”分组：按书名聚合（同一本书只出一张卡片，副标题提示命中章节数）
async function searchBooks(q: string, page: number) {
  const like = `%${q}%`;
  const grouped = await queryRows<{ TypeID: number; c: number }>(
    `SELECT TypeID, COUNT(*) c FROM zysjllsj WHERE BiaoTi LIKE ? OR NeiRong LIKE ? GROUP BY TypeID`,
    [like, like]
  );
  const hitMap = new Map<number, number>(grouped.map((r) => [r.TypeID, r.c]));
  const titleHits = new Set<number>();
  for (const [tid, m] of BOOK_TITLES) {
    if (m.title.includes(q) || (m.author && m.author.includes(q))) titleHits.add(tid);
  }
  const typeIds = [...new Set([...hitMap.keys(), ...titleHits])].sort((a, b) => a - b);
  const total = typeIds.length;
  const offset = (page - 1) * PAGE_SIZE;
  const pageIds = typeIds.slice(offset, offset + PAGE_SIZE);
  const items = pageIds.map((tid) => {
    const m = BOOK_TITLES.get(tid);
    const info = bookInfo(tid);
    const hit = hitMap.get(tid) ?? (titleHits.has(tid) ? (m ? m.count : 0) : 0);
    return {
      id: tid,
      title: info.title,
      subtitle: `含 ${hit} 处匹配 · 共 ${(m ? m.count : 0)} 章`,
    };
  });
  return {
    key: "works",
    name: MODULES.works.name,
    icon: MODULES.works.icon,
    kind: "book" as const,
    total,
    page,
    pageSize: PAGE_SIZE,
    items,
  };
}

// TuPian 形如 "renshen_1.jpg,renshen_2.jpg,renshen_3.jpg"，拆成多图供详情页轮播。
// 注意：源库仅约 356/18295 味（1.9%）带图片记录，且备份中不含图片实体文件，
// 因此前端需对缺失做占位处理（见 HerbDetail.tsx 的 <HerbGallery />）。
function parseImages(raw: unknown): string[] {
  if (!raw) return [];
  return String(raw)
    .split(/[,，;；]/)
    .map((s) => s.trim())
    .filter((s) => /^[\w.\-]+\.(jpg|jpeg|png|webp|gif)$/i.test(s));
}

// FuFang 形如：
//   1、尿痛，尿急，尿血：（小蓟饮子）小蓟、生地黄…各等量，研成粗粉…
//   2、传染性肝炎：鲜小蓟根状茎2两，水煎服。
// 解析为「主治 → 方名（若有）+ 组成用法」，供详情页「相关方剂」模块展示。
function parseFormulas(raw: unknown): { title: string; formula?: string; body: string }[] {
  if (!raw) return [];
  const out: { title: string; formula?: string; body: string }[] = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    const no = text.match(/^\d+\s*[、.．)）]\s*([\s\S]+)$/);
    const content = (no ? no[1] : text).trim();
    // 「主治：方剂内容」
    const sm = content.match(/^([\s\S]{1,60}?)[：:]\s*([\s\S]+)$/);
    let title = content;
    let body = "";
    if (sm) {
      title = sm[1].trim();
      body = sm[2].trim();
    } else {
      title = content.slice(0, 24);
      body = content;
    }
    // 方剂名：括号内以 方/汤/散/丸/饮子/饮/丹/膏 结尾的词，如「（小蓟饮子）」
    const fm = body.match(/[（(]([^）)]{2,14}(?:方|汤|散|丸|饮子|饮|丹|膏))[）)]/);
    out.push({ title, formula: fm ? fm[1] : undefined, body });
    if (out.length >= 12) break;
  }
  return out;
}

function herbDetail(row: Record<string, any>) {
  const groups = HERB_FIELD_GROUPS.map((g) => ({
    group: g.group,
    fields: g.fields
      .map((f) => ({ label: f.label, value: decodeEntities(row[f.col] ?? "") }))
      .filter((f) => f.value && String(f.value).trim().length > 0),
  })).filter((g) => g.fields.length > 0);
  const prose = formatProse(
    [row.GongNengZZ, row.LinChuangYY, row.GeJiaLS, row.ZhaiLu, row.BeiZhu, row.FuFang]
      .filter(Boolean)
      .join("\n\n")
  );
  return {
    key: "herbs",
    kind: "herb" as const,
    title: decodeEntities(row.MingCheng),
    meta: {
      拼音: decodeEntities(row.PinYin),
      英文名: decodeEntities(row.YingWenMing),
      别名: decodeEntities(row.BieMing),
      出处: decodeEntities(row.ChuChu),
    },
    groups,
    prose,
    keyword: row.KeyWord || "",
    // 整页详情新增字段（原抽屉未使用）
    images: parseImages(row.TuPian),
    related: parseFormulas(row.FuFang),
    origin: {
      source: decodeEntities(row.LaiYuan ?? ""),     // 来源（基原：科属 + 药用部位）
      habitat: decodeEntities(row.ShengJingFB ?? ""), // 生境分布 / 产地
      morphology: decodeEntities(row.YuanXingTai ?? ""), // 原植物形态
      storage: decodeEntities(row.ZhuCang ?? ""),     // 贮藏
    },
  };
}

async function getResource(key: string, id: string) {
  const cfg = MODULES[key];
  const row = await queryOne<Record<string, any>>(
    `SELECT * FROM ${cfg.table} WHERE ${cfg.idCol} = ?`,
    [id]
  );
  if (!row) return null;

  if (cfg.kind === "herb") return herbDetail(row);

  // book / article
  const prose = formatProse(row.NeiRong);

  // ② 著作详情：按 (TypeID, id) 取同书相邻章节，生成上一章/下一章导航
  let nav: { prev: { id: string | number; title: string } | null; next: { id: string | number; title: string } | null } | undefined;
  let bookId: number | undefined;
  let bookTitle: string | undefined;
  if (cfg.kind === "book") {
    const tid = (row as Record<string, any>).TypeID;
    const curId = row[cfg.idCol];
    const info = bookInfo(tid);
    bookId = tid;
    bookTitle = info.title;
    const prevRow = await queryOne<Record<string, any>>(
      `SELECT ${cfg.idCol} AS id, ${cfg.titleCol} AS title FROM ${cfg.table} WHERE TypeID = ? AND ${cfg.idCol} < ? ORDER BY ${cfg.idCol} DESC LIMIT 1`,
      [tid, curId]
    );
    const nextRow = await queryOne<Record<string, any>>(
      `SELECT ${cfg.idCol} AS id, ${cfg.titleCol} AS title FROM ${cfg.table} WHERE TypeID = ? AND ${cfg.idCol} > ? ORDER BY ${cfg.idCol} ASC LIMIT 1`,
      [tid, curId]
    );
    nav = {
      prev: prevRow ? { id: prevRow.id, title: decodeEntities(prevRow.title) } : null,
      next: nextRow ? { id: nextRow.id, title: decodeEntities(nextRow.title) } : null,
    };
  }

  return {
    key,
    kind: cfg.kind,
    title: decodeEntities(row[cfg.titleCol]),
    meta: cfg.kind === "article" ? { 关键词: row.KeyWord || "", 时间: row.ShiJian || "" } : { 时间: row.ShiJian || "" },
    prose,
    keyword: row.KeyWord || "",
    nav,
    ...(cfg.kind === "book" ? { bookId, bookTitle } : {}),
  };
}

async function getHerb(id: string) {
  const row = await queryOne<Record<string, any>>(
    `SELECT * FROM ${HERB_TABLE} WHERE ID = ? AND TypeID = 40`,
    [id]
  );
  if (!row) return null;
  const detail = herbDetail(row);
  // 附带结构化标注（功效分类/毒性/归经等），供详情页「数据标注」区展示
  const ann = HERB_ATTRS.get(Number(id));
  // 关联汤方：由汤方索引反查「组成中含本药材」的汤方（含总数，详情页展示前 8 首）
  let rxRel: { total: number; items: { id: string; title: string; usage: string }[] } = { total: 0, items: [] };
  try {
    rxRel = await herbRelatedRx(Number(id), 8);
  } catch (e) {
    console.warn("[tcm-server] 读取关联汤方失败：", e);
  }
  return { ...(ann ? { ...detail, annotation: ann } : detail), rx: rxRel };
}

interface HerbQuery {
  q?: string;
  letter?: string;
  nature?: string;
  flavor?: string;
  effect?: string; // 功效分类，来自标注文件 herb_attributes.json
  meridian?: string;
  page: number;
}

async function getHerbs(opts: HerbQuery) {
  const clauses = [HERB_BASE];
  const params: any[] = [];
  if (opts.q) {
    const like = `%${opts.q}%`;
    clauses.push(
      "(MingCheng LIKE ? OR BieMing LIKE ? OR PinYin LIKE ? OR YingWenMing LIKE ? OR GongNengZZ LIKE ? OR GuiJing LIKE ? OR XingWei LIKE ?)"
    );
    params.push(...Array(7).fill(like));
  }
  if (opts.letter) {
    clauses.push("UPPER(substr(PinYin, 1, 1)) = ?");
    params.push(opts.letter.toUpperCase());
  }
  if (opts.nature && opts.nature !== "全部") {
    clauses.push(`(${NATURE_CASE}) = ?`);
    params.push(opts.nature);
  }
  if (opts.flavor && opts.flavor !== "全部") {
    // “其他”表示性味中不含任何标准五味（如仅淡/涩），需用否定条件；直接 LIKE '其他' 会查不到数据
    if (opts.flavor === "其他") {
      clauses.push(`(${FLAVOR_STANDARD.map(() => "XingWei NOT LIKE ?").join(" AND ")})`);
      params.push(...FLAVOR_STANDARD.map((f) => `%${f}%`));
    } else {
      clauses.push("XingWei LIKE ?");
      params.push(`%${opts.flavor}%`);
    }
  }
  // 功效分类来自标注文件（非源库字段），先取命中 ID 再用 IN 过滤
  if (opts.effect && opts.effect !== "全部") {
    const ids: number[] = [];
    for (const [id, a] of HERB_ATTRS) if (a.effect === opts.effect) ids.push(id);
    clauses.push(ids.length ? `ID IN (${ids.map(() => "?").join(",")})` : "1 = 0");
    params.push(...ids);
  }
  if (opts.meridian) {
    clauses.push("GuiJing LIKE ?");
    params.push(`%${opts.meridian}%`);
  }
  const where = "WHERE " + clauses.join(" AND ");

  const totalRow = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${HERB_TABLE} ${where}`, params);
  const total = totalRow?.c ?? 0;
  const offset = (opts.page - 1) * PAGE_SIZE;
  const rows = await queryRows<Record<string, any>>(
    `SELECT ID AS id, MingCheng AS title, XingWei AS xingwei, GuiJing AS guijing, GongNengZZ AS gongneng, PinYin AS pinyin FROM ${HERB_TABLE} ${where} ORDER BY MingCheng LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, offset]
  );
  const items = rows.map((r) => ({
    id: r.id,
    title: decodeEntities(r.title),
    subtitle: r.xingwei ? excerpt(r.xingwei, 40) : "",
    pinyin: decodeEntities(r.pinyin) || "",
    meridian: decodeEntities(r.guijing) || "",
    gongneng: decodeEntities(r.gongneng) || "",
  }));

  // 分类维度统计（基于全部中药材，便于切换筛选项）
  const letterRows = await queryRows<{ L: string; c: number }>(
    `SELECT UPPER(substr(PinYin, 1, 1)) AS L, COUNT(*) c FROM ${HERB_TABLE} WHERE ${HERB_BASE} AND UPPER(substr(PinYin, 1, 1)) REGEXP '^[A-Z]$' GROUP BY L ORDER BY L`
  );
  const natureRows = await queryRows<{ N: string; c: number }>(
    `SELECT (${NATURE_CASE}) AS N, COUNT(*) c FROM ${HERB_TABLE} WHERE ${HERB_BASE} GROUP BY N`
  );
  // 规范化：始终返回标准的五种四气（温/热/寒/凉/平），“其他”仅在非空时附在末尾
  const natureMap = new Map(natureRows.map((r) => [r.N, r.c]));
  const natureFacets = [
    ...NATURE_STANDARD.map((n) => ({ value: n, count: natureMap.get(n) ?? 0 })),
    ...((natureMap.get("其他") ?? 0) > 0 ? [{ value: "其他", count: natureMap.get("其他")! }] : []),
  ];
  // 五味统计：按“是否含某味”分别计数（一味药可同时有辛+苦），其余（仅淡/涩等）归为“其他”
  const flavorSums = FLAVOR_STANDARD.map(
    (f) => `SUM(CASE WHEN XingWei LIKE '%${f}%' THEN 1 ELSE 0 END) AS \`${f}\``
  ).join(", ");
  const flavorRow = await queryOne<Record<string, number>>(
    `SELECT ${flavorSums}, SUM(CASE WHEN XingWei NOT LIKE '%辛%' AND XingWei NOT LIKE '%甘%' AND XingWei NOT LIKE '%酸%' AND XingWei NOT LIKE '%苦%' AND XingWei NOT LIKE '%咸%' THEN 1 ELSE 0 END) AS \`其他\` FROM ${HERB_TABLE} WHERE ${HERB_BASE}`
  );
  const flavorOther = flavorRow?.["其他"] ?? 0;
  const flavorFacets = [
    ...FLAVOR_STANDARD.map((f) => ({ value: f, count: flavorRow?.[f] ?? 0 })),
    ...(flavorOther > 0 ? [{ value: "其他", count: flavorOther }] : []),
  ];
  // 功效分类统计（来自标注文件，按数量降序）
  const effectMap = new Map<string, number>();
  for (const a of HERB_ATTRS.values()) effectMap.set(a.effect, (effectMap.get(a.effect) ?? 0) + 1);
  const effectFacets = [...effectMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }));
  const meridianSums = MERIDIANS.map((m) => `SUM(CASE WHEN GuiJing LIKE '%${m}%' THEN 1 ELSE 0 END) AS \`${m}\``).join(", ");
  const meridianRow = await queryOne<Record<string, number>>(
    `SELECT ${meridianSums} FROM ${HERB_TABLE} WHERE ${HERB_BASE}`
  );

  return {
    total,
    page: opts.page,
    pageSize: PAGE_SIZE,
    items,
    facets: {
      letters: letterRows.map((r) => ({ letter: r.L, count: r.c })),
      natures: natureFacets,
      flavors: flavorFacets,
      effects: effectFacets,
      meridians: MERIDIANS.filter((m) => meridianRow && (meridianRow[m] ?? 0) > 0).map((m) => ({
        value: m,
        count: meridianRow?.[m] ?? 0,
      })),
    },
  };
}

// ===== 四性 × 五味 交叉统计（聚合视图数据源）=====
// 四气为单值（由 NATURE_CASE 派生），五味可并存（按“是否含某味”分别计数），
// 因此“列合计”之和会大于总数，属预期行为（一味药可同时计入辛与苦）。
async function getNatureFlavorMatrix() {
  // 每个四气分组下的五味分布；末列为“其他”（性味中不含任何标准五味，如仅淡/涩）
  const noFlavorCond = FLAVOR_STANDARD.map((f) => `XingWei NOT LIKE '%${f}%'`).join(" AND ");
  const flavorCols = [
    ...FLAVOR_STANDARD.map((f) => `SUM(CASE WHEN XingWei LIKE '%${f}%' THEN 1 ELSE 0 END) AS \`${f}\``),
    `SUM(CASE WHEN ${noFlavorCond} THEN 1 ELSE 0 END) AS \`其他\``,
    `COUNT(*) AS \`合计\``,
  ].join(", ");
  const rows = await queryRows<Record<string, number>>(
    `SELECT (${NATURE_CASE}) AS n, ${flavorCols} FROM ${HERB_TABLE} WHERE ${HERB_BASE} GROUP BY n`
  );
  const byNature = new Map<string, Record<string, number>>();
  for (const r of rows) byNature.set(String(r.n), r as Record<string, number>);

  // 行（四气）始终按标准顺序展示，避免某类为 0 时缺行；“其他”仅在有数据时附后
  const natureAxis = [
    ...NATURE_STANDARD,
    ...(byNature.has("其他") ? ["其他"] : []),
  ];
  // 列（五味）同样按标准顺序；“其他”列仅在任一四气下存在此类药时展示
  const hasOtherFlavor = natureAxis.some((n) => (byNature.get(n)?.["其他"] ?? 0) > 0);
  const flavorAxis = [...FLAVOR_STANDARD, ...(hasOtherFlavor ? ["其他"] : [])];

  const cells: Record<string, number> = {};
  const rowTotals: Record<string, number> = {};
  const colTotals: Record<string, number> = {};
  for (const f of flavorAxis) colTotals[f] = 0;

  let grandTotal = 0;
  for (const n of natureAxis) {
    const r = byNature.get(n) ?? ({} as Record<string, number>);
    for (const f of flavorAxis) {
      const c = Number(r[f] ?? 0);
      cells[`${n}|${f}`] = c;
      colTotals[f] = (colTotals[f] ?? 0) + c;
    }
    rowTotals[n] = Number(r["合计"] ?? 0);
    grandTotal += rowTotals[n];
  }

  return { natures: natureAxis, flavors: flavorAxis, cells, rowTotals, colTotals, total: grandTotal };
}

async function searchAll(q: string, page: number) {
  const like = `%${q}%`;
  const results: any[] = [];
  let grandTotal = 0;
  for (const key of REAL_MODULE_KEYS) {
    const cfg = MODULES[key];
    // 著作类（works）：按书名聚合，同一本书只出一张卡片
    if (cfg.kind === "book") {
      const d = await searchBooks(q, page);
      grandTotal += d.total;
      results.push(d);
      continue;
    }
    const colConds = cfg.searchCols.map((c) => `${c} LIKE ?`).join(" OR ");
    let where = cfg.filter ? `(${cfg.filter}) AND (${colConds})` : `(${colConds})`;
    const params = cfg.searchCols.map(() => like);
    const totalRow = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ${cfg.table} WHERE ${where}`,
      params
    );
    const total = totalRow?.c ?? 0;
    grandTotal += total;
    const offset = (page - 1) * PAGE_SIZE;
    const rows = await queryRows<Record<string, any>>(
      `SELECT ${cfg.idCol} AS id, ${cfg.titleCol} AS title, ${subtitleSql(cfg)} FROM ${cfg.table} WHERE ${where} ORDER BY (${cfg.titleCol} LIKE ?) DESC, id LIMIT ? OFFSET ?`,
      [...params, like, PAGE_SIZE, offset]
    );
    results.push({
      key,
      name: cfg.name,
      icon: cfg.icon,
      kind: cfg.kind,
      total,
      items: rows.map((r) => ({ id: r.id, title: r.title, subtitle: r.subtitle ? excerpt(r.subtitle, 40) : "" })),
    });
  }
  return { q, total: grandTotal, page, pageSize: PAGE_SIZE, results };
}

async function getHome() {
  const sections = await Promise.all(
    REAL_MODULE_KEYS.map(async (key) => {
      const cfg = MODULES[key];
      // 著作首页示例改为“书名”聚合（每本书一张卡片）
      if (key === "works") {
        const count = (await queryOne<{ c: number }>(`SELECT COUNT(DISTINCT TypeID) c FROM zysjllsj`))?.c ?? 0;
        const bids = (
          (await queryRows<{ TypeID: number }>(`SELECT DISTINCT TypeID FROM zysjllsj ORDER BY TypeID LIMIT 8`)) as any[]
        ).map((r) => r.TypeID);
        const samples = bids.map((tid) => {
          const info = bookInfo(tid);
          const m = BOOK_TITLES.get(tid);
          return { id: tid, title: info.title, subtitle: m ? excerpt(m.first, 30) : "" };
        });
        return { key, name: cfg.name, icon: cfg.icon, desc: cfg.desc, count, samples };
      }
      const count = await moduleCount(key);
      const rows = await queryRows<Record<string, any>>(
        `SELECT ${cfg.idCol} AS id, ${cfg.titleCol} AS title, ${subtitleSql(cfg)} FROM ${cfg.table} ${cfg.filter ? `WHERE ${cfg.filter}` : ""} ORDER BY id LIMIT 8`
      );
      const samples = rows.map((r) => ({ id: r.id, title: r.title, subtitle: r.subtitle ? excerpt(r.subtitle, 30) : "" }));
      return { key, name: cfg.name, icon: cfg.icon, desc: cfg.desc, count, samples };
    })
  );
  // 汤方模块（独立于 MODULES：数据源是自建库 + 源库方剂索引，走 /api/prescriptions）
  const rxSection = homeRxSection();
  return {
    sections: rxSection ? [...sections, rxSection] : sections,
    glossaryCount: GLOSSARY.length,
    textbookCount: TEXTBOOKS.length,
    examCount: EXAM_RESOURCES.length,
  };
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "public, max-age=60",
    },
  });
}

function getQuery(url: URL, name: string, def = ""): string {
  return url.searchParams.get(name) ?? def;
}

async function handleApi(path: string, url: URL, req: Request): Promise<Response | null> {
  const cacheKey = `api:${path}:${url.search}`;
  if (path === "/api/health") {
    return json({ ok: true, db: await dbAlive() });
  }

  if (path === "/api/home") {
    const data = await cached(cacheKey, 120_000, getHome);
    return json(data);
  }

  if (path === "/api/modules") {
    return json({
      modules: REAL_MODULE_KEYS.map((k) => ({
        key: k,
        name: MODULES[k].name,
        icon: MODULES[k].icon,
        desc: MODULES[k].desc,
        kind: MODULES[k].kind,
      })),
      glossaryCount: GLOSSARY.length,
      textbookCount: TEXTBOOKS.length,
      examCount: EXAM_RESOURCES.length,
    });
  }

  if (path === "/api/list") {
    const module = getQuery(url, "module");
    if (!MODULES[module]) return json({ error: "unknown module" }, 400);
    const page = Math.max(1, parseInt(getQuery(url, "page", "1")) || 1);
    const q = getQuery(url, "q") || undefined;
    const data = await cached(cacheKey, 60_000, () => listModule(module, page, q));
    return json(data);
  }

  // 著作列表：按书名（TypeID）聚合
  if (path === "/api/books") {
    const page = Math.max(1, parseInt(getQuery(url, "page", "1")) || 1);
    const q = getQuery(url, "q") || undefined;
    const data = await cached(cacheKey, 60_000, () => listBooks(q, page));
    return json(data);
  }

  // 单本书目录：/api/book/:typeId（可带 q 在书内检索章节）
  if (path.startsWith("/api/book/")) {
    const typeId = parseInt(path.slice("/api/book/".length));
    if (!typeId || isNaN(typeId)) return json({ error: "bad params" }, 400);
    const q = getQuery(url, "q") || undefined;
    const data = await getBookToc(typeId, q);
    return json(data);
  }

  if (path === "/api/resource") {
    const module = getQuery(url, "module");
    const id = getQuery(url, "id");
    if (!MODULES[module] || !id) return json({ error: "bad params" }, 400);
    const data = await getResource(module, id);
    if (!data) return json({ error: "not found" }, 404);
    return json(data);
  }

  if (path === "/api/search") {
    const q = getQuery(url, "q");
    if (!q) return json({ q: "", total: 0, results: [] });
    const page = Math.max(1, parseInt(getQuery(url, "page", "1")) || 1);
    const data = await cached(cacheKey, 60_000, () => searchAll(q, page));
    return json(data);
  }

  if (path === "/api/herbs") {
    const q = getQuery(url, "q") || undefined;
    const letter = getQuery(url, "letter") || undefined;
    const nature = getQuery(url, "nature") || undefined;
    const flavor = getQuery(url, "flavor") || undefined;
    const effect = getQuery(url, "effect") || undefined;
    const meridian = getQuery(url, "meridian") || undefined;
    const page = Math.max(1, parseInt(getQuery(url, "page", "1")) || 1);
    const data = await cached(cacheKey, 60_000, () => getHerbs({ q, letter, nature, flavor, effect, meridian, page }));
    return json(data);
  }

  // 药材名联想（供汤方组成录入）：只按药名 / 别名匹配，正名优先，不参与全文检索
  if (path === "/api/herb-suggest") {
    const q = (getQuery(url, "q") || "").trim();
    if (!q) return json({ items: [] });
    const like = `%${q}%`;
    const rows = await queryRows<{ ID: number; MingCheng: string; PinYin: string }>(
      `SELECT ID, MingCheng, PinYin FROM ${HERB_TABLE}
       WHERE ${HERB_BASE} AND (MingCheng LIKE ? OR BieMing LIKE ?) LIMIT 60`,
      [like, like]
    );
    // 与 /api/herbs 不同，这里按相关度排序：正名完全匹配 > 前缀匹配 > 包含
    const rank = (t: string) => (t === q ? 0 : t.startsWith(q) ? 1 : 2);
    const seen = new Set<string>();
    const items: { id: number; title: string; pinyin: string }[] = [];
    for (const r of rows
      .slice()
      .sort((a, b) => rank(a.MingCheng) - rank(b.MingCheng) || a.MingCheng.length - b.MingCheng.length)) {
      const title = decodeEntities(r.MingCheng || "");
      if (seen.has(title)) continue;
      seen.add(title);
      items.push({ id: Number(r.ID), title, pinyin: decodeEntities(r.PinYin || "") });
      if (items.length >= 8) break;
    }
    return json({ items });
  }

  // 数据源总览：数据画像 + 标注聚合统计（信息聚合视图）
  if (path === "/api/stats") {
    const bookCat = BOOK_ANNOTATIONS
      ? Object.values(BOOK_ANNOTATIONS).reduce((m: Record<string, number>, b: any) => {
          m[b.category] = (m[b.category] ?? 0) + 1;
          return m;
        }, {})
      : {};
    const data = await cached(cacheKey, 300_000, async () => ({
      profile: DATA_PROFILE,
      entityCategories: ENTITY_CATEGORIES,
      herbAnnotationCount: HERB_ATTRS.size,
      bookCategory: bookCat,
      generatedAt: DATA_PROFILE?.generatedAt ?? null,
    }));
    return json(data);
  }

  // 四性 × 五味 交叉统计（聚合视图）
  if (path === "/api/herbs/matrix") {
    const data = await cached(cacheKey, 300_000, getNatureFlavorMatrix);
    return json(data);
  }

  if (path.startsWith("/api/herb/")) {
    const id = decodeURIComponent(path.slice("/api/herb/".length));
    const data = await getHerb(id);
    if (!data) return json({ error: "not found" }, 404);
    return json(data);
  }

  // ===== 汤方（源库 TypeID=39 方剂 + 用户自建）=====
  // 列表：自建汤方排在最前，其后为源库方剂；支持 关键词 / 拼音 / 出处 / 功效 / 含某药材 筛选
  if (path === "/api/prescriptions" && req.method === "GET") {
    const q = getQuery(url, "q") || undefined;
    const letter = getQuery(url, "letter") || undefined;
    const origin = getQuery(url, "origin") || undefined;
    const effect = getQuery(url, "effect") || undefined;
    const herb = getQuery(url, "herb") || undefined;
    const page = Math.max(1, parseInt(getQuery(url, "page", "1")) || 1);
    // 写入操作递增 rxVersion，使列表缓存随之失效
    const data = await cached(`${cacheKey}#v${rxVersion}`, 60_000, () =>
      listPrescriptions({ q, letter, origin, effect, herbId: herb, page })
    );
    return json(data);
  }

  // 新建汤方（自建，写入 data/tcm_rx.sqlite，不触碰源库）
  if (path === "/api/prescriptions" && req.method === "POST") {
    const body = await readJson(req);
    if (!body) return json({ ok: false, errors: ["请求体不是合法 JSON"] }, 400);
    const v = validateRx(body);
    if (!v.ok) return json({ ok: false, errors: v.errors }, 400);
    const { id } = await createPrescription(body);
    rxVersion++;
    return json({ ok: true, id });
  }

  // 汤方详情 / 更新 / 删除 / 恢复 / 还原原值：/api/prescription/:id[/action]
  if (path.startsWith("/api/prescription/")) {
    const rest = path.slice("/api/prescription/".length);
    const [rawId, action] = rest.split("/");
    const id = decodeURIComponent(rawId || "");
    if (!id) return json({ error: "bad params" }, 400);
    if (req.method === "GET" && !action) {
      const data = await getPrescription(id);
      if (!data) return json({ error: "not found" }, 404);
      return json(data);
    }
    if (req.method === "PUT" && !action) {
      const body = await readJson(req);
      if (!body) return json({ ok: false, errors: ["请求体不是合法 JSON"] }, 400);
      const v = validateRx(body);
      if (!v.ok) return json({ ok: false, errors: v.errors }, 400);
      const r = await updatePrescription(id, body);
      if (!r.ok) return json({ ok: false, errors: [r.reason ?? "更新失败"] }, r.reason === "汤方不存在" ? 404 : 400);
      rxVersion++;
      return json({ ok: true });
    }
    if (req.method === "DELETE" && !action) {
      const r = await deletePrescription(id);
      if (!r.ok) return json({ ok: false, errors: [r.reason ?? "删除失败"] }, 404);
      rxVersion++;
      return json({ ok: true });
    }
    // 撤销删除（仅源库方剂：删除是写入隐藏名单，源数据从未改动）
    if (req.method === "POST" && action === "restore") {
      const r = await restorePrescription(id);
      if (!r.ok) return json({ ok: false, errors: [r.reason ?? "恢复失败"] }, 400);
      rxVersion++;
      return json({ ok: true });
    }
    // 还原为源库原始内容（撤销对该方剂的修改）
    if (req.method === "POST" && action === "reset") {
      const r = await resetPrescription(id);
      rxVersion++;
      return json({ ok: true, reason: r.reason ?? null });
    }
    return json({ error: "method not allowed" }, 405);
  }

  // 药材图片：优先取 data/herb_images/<file> 实体文件；
  // 【数据缺失兜底】备份中不含图片实体文件（仅 TuPian 文件名，覆盖约 1.9%），
  // 缺失时返回内联 SVG 占位图，保证详情页版式完整；日后把图片放入该目录即自动生效。
  if (path.startsWith("/api/herb-img/")) {
    const file = decodeURIComponent(path.slice("/api/herb-img/".length));
    if (!/^[\w.\-]+\.(jpg|jpeg|png|webp|gif)$/i.test(file)) return new Response("bad name", { status: 400 });
    try {
      const s = await stat(join(HERB_IMG_DIR, file));
      if (s.isFile()) {
        const ext = (file.split(".").pop() || "").toLowerCase();
        const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
        return new Response(Bun.file(join(HERB_IMG_DIR, file)), {
          headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" },
        });
      }
    } catch {}
    return new Response(placeholderSvg(), { headers: { "Content-Type": "image/svg+xml; charset=utf-8" } });
  }

  if (path === "/api/glossary") {
    const q = getQuery(url, "q") || undefined;
    const cat = getQuery(url, "cat") || undefined;
    let items = GLOSSARY;
    if (q) items = items.filter((t) => t.term.includes(q) || t.definition.includes(q) || t.pinyin.includes(q));
    if (cat) items = items.filter((t) => t.category === cat);
    const categories = Array.from(new Set(GLOSSARY.map((t) => t.category)));
    return json({ items, categories });
  }

  if (path === "/api/textbooks") return json({ items: TEXTBOOKS });
  if (path === "/api/exam") return json({ items: EXAM_RESOURCES });
  if (path === "/api/manual") return json({ sections: MANUAL_SECTIONS });

  return null;
}

// 生产环境：若 dist 存在则托管静态前端（SPA）
import { stat } from "node:fs/promises";
import { join } from "node:path";

const DIST = join(import.meta.dir, "..", "dist");

async function serveStatic(pathname: string): Promise<Response | null> {
  let rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = join(DIST, rel);
  try {
    const s = await stat(filePath);
    if (s.isFile()) {
      const ext = filePath.split(".").pop() || "";
      const mime = ext === "html" ? "text/html" : ext === "js" ? "text/javascript" : ext === "css" ? "text/css" : "application/octet-stream";
      return new Response(Bun.file(filePath), { headers: { "Content-Type": mime } });
    }
  } catch {}
  // SPA fallback
  try {
    await stat(join(DIST, "index.html"));
    return new Response(Bun.file(join(DIST, "index.html")), { headers: { "Content-Type": "text/html" } });
  } catch {}
  return null;
}

const fetchHandler = async (req: Request) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) {
    const res = await handleApi(url.pathname, url, req);
    return res ?? json({ error: "not found" }, 404);
  }
  const st = await serveStatic(url.pathname);
  if (st) return st;
  return new Response("岐黄阁 (Qihuang Ge) — 前端尚未构建。请先执行 `bun run build`，再运行 `bun run start`。", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};

// 依次尝试候选端口，首个可用的即对外服务（应对端口被系统保留/占用）
function startServer() {
  for (const p of PORT_FALLBACKS) {
    try {
      const server = serve({ port: p, fetch: fetchHandler });
      console.log(`[tcm-server] listening on http://127.0.0.1:${p}`);
      return server;
    } catch (e: any) {
      if (e?.code !== "EADDRINUSE") throw e;
      console.warn(`[tcm-server] port ${p} unavailable (EADDRINUSE), trying next…`);
    }
  }
  throw new Error(`[tcm-server] no available port among ${PORT_FALLBACKS.join(", ")}`);
}

startServer();
