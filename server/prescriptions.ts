// ===== 汤方模块：数据层 =====
// 关键设计（对应需求中「不得影响已有中药材数据的完整性」）：
//   源库 zysjyj（TypeID=39 方剂 52050 条）**只读**，任何写入都发生在独立文件
//   data/tcm_rx.sqlite。用户对源方剂的修改以「覆盖层 override」形式存放，删除以「隐藏名单」
//   形式存放，源库始终保持迁移时的原样；用户新建的汤方与源方剂在列表中混排展示。
// 汤方 id 形如 s123（源）/ c45（自建），便于 URL 使用。
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { queryRows, queryOne } from "./db";
import { detectEffect } from "./effect";
import { decodeEntities, excerpt } from "./text";

// 源库方剂表与自建库分工：
//   zysjyj —— 只读（TypeID=39 方剂）
//   tcm_rx.sqlite —— 可写（自有数据：自建汤方 / 源方剂覆盖 / 删除名单 / 组成索引 / 元信息）
const RX_DB_PATH = join(import.meta.dir, "..", "data", "tcm_rx.sqlite");
const rx = new Database(RX_DB_PATH, { create: true });
rx.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");

// ===== 表结构 =====
// 字段名沿用源库命名风格（MingCheng / ChuFang / GongNengZZ / YongFaYL / ZhuYi / BeiZhu / ZhaiLu / PaoZhi），
// 与中药材模块的 HERB_FIELD_GROUPS 保持一致。
rx.exec(`
CREATE TABLE IF NOT EXISTS rx_custom (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  MingCheng TEXT NOT NULL,
  PinYin TEXT, BieMing TEXT, ZhaiLu TEXT, ChuFang TEXT,
  YongFaYL TEXT, GongNengZZ TEXT, ZhuYi TEXT, BeiZhu TEXT, PaoZhi TEXT,
  createdAt INTEGER, updatedAt INTEGER
);
CREATE TABLE IF NOT EXISTS rx_overrides (
  sourceId INTEGER PRIMARY KEY,
  MingCheng TEXT, PinYin TEXT, BieMing TEXT, ZhaiLu TEXT, ChuFang TEXT,
  YongFaYL TEXT, GongNengZZ TEXT, ZhuYi TEXT, BeiZhu TEXT, PaoZhi TEXT,
  updatedAt INTEGER
);
CREATE TABLE IF NOT EXISTS rx_deleted (
  sourceId INTEGER PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS rx_herbs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rxKey TEXT NOT NULL,
  kind INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL DEFAULT 0,
  herbId INTEGER,
  name TEXT NOT NULL,
  note TEXT,
  dosage TEXT,
  raw TEXT
);
CREATE INDEX IF NOT EXISTS idx_rx_herbs_key ON rx_herbs(rxKey, kind, seq);
CREATE INDEX IF NOT EXISTS idx_rx_herbs_herb ON rx_herbs(herbId);
CREATE TABLE IF NOT EXISTS rx_meta (
  rxKey TEXT PRIMARY KEY,
  custom INTEGER NOT NULL DEFAULT 0,
  state INTEGER NOT NULL DEFAULT 0,
  MingCheng TEXT NOT NULL,
  PinYin TEXT,
  letter TEXT,
  effect TEXT,
  origin TEXT,
  herbCount INTEGER NOT NULL DEFAULT 0,
  updatedAt INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rx_meta_list ON rx_meta(custom, state);
`);

// ===== 药材名 → 药材 ID 字典（用于组成关联）=====
// 源库药材 18295 条中只有 11243 个不同名称，存在大量重名条目（同一味药多条记录）。
// 因此：字典按名称映射到一个主 ID（取首次出现，稳定）；同时保留「名称 → 全部同名 ID」，
// 供药材详情页反查汤方时展开，避免只按某一条记录的 ID 查询而落空。
let HERB_DICT = new Map<string, number>();
let HERB_NAME_IDS = new Map<string, number[]>();
let HERB_ID_GROUP = new Map<number, number[]>();
let HERB_DICT_READY = false;

// 与给定药材 ID 同名的全部 ID（用于反查，解决重名导致的漏查）
export function herbIdGroup(herbId: number): number[] {
  return HERB_ID_GROUP.get(Number(herbId)) ?? [Number(herbId)];
}

export async function ensureHerbDict(force = false) {
  if (HERB_DICT_READY && !force) return;
  const rows = await queryRows<{ ID: number; MingCheng: string; BieMing: string }>(
    `SELECT ID, MingCheng, BieMing FROM zysjyj WHERE TypeID = 40`
  );
  const map = new Map<string, number>();
  const idsByName = new Map<string, number[]>();
  for (const r of rows) {
    const id = Number(r.ID);
    const name = decodeEntities(r.MingCheng || "").trim();
    // 重名条目：主 ID 取首次出现（稳定），同时记录全部同名 ID 供反查展开
    if (name) {
      if (!map.has(name)) map.set(name, id);
      const arr = idsByName.get(name) ?? [];
      arr.push(id);
      idsByName.set(name, arr);
    }
    for (const a of (decodeEntities(r.BieMing || "") || "").split(/[、,，;；\s]+/)) {
      const alias = a.trim();
      if (alias && !map.has(alias)) map.set(alias, id);
    }
  }
  // id → 同名组（含自身），供药材详情页反查汤方
  const idGroup = new Map<number, number[]>();
  for (const ids of idsByName.values()) for (const id of ids) idGroup.set(id, ids);
  // 处方名 → 正名：正名不存在时自动跳过（不强行关联）
  let aliasHits = 0;
  for (const [alias, canon] of Object.entries(RX_ALIAS)) {
    const id = map.get(canon);
    if (id != null && !map.has(alias)) {
      map.set(alias, id);
      aliasHits++;
    }
  }
  if (force) console.log(`[tcm-server] 处方别名映射生效 ${aliasHits}/${Object.keys(RX_ALIAS).length} 条`);
  HERB_DICT = map;
  HERB_NAME_IDS = idsByName;
  HERB_ID_GROUP = idGroup;
  HERB_DICT_READY = true;
  if (force) console.log(`[tcm-server] 药材名词典已载入 ${map.size} 条`);
}

// ===== 组成解析 =====
export interface CompositionRow {
  herbId: number | null; // 关联到的药材 ID（未匹配为 null）
  name: string;          // 药材名（已剥离炮制修饰）
  note: string;          // 炮制/特殊标注（去节、炒、炙…）
  dosage: string;        // 用量（如 6g、二钱半）
  raw: string;           // 原始片段
  matched: boolean;
}

// 剂量单位：古制（两/钱/分/厘/斤/铢/枚/片/盏/升/合/字/匕）与现代（g/克/ml）并存
const DOSE_UNIT = "两|钱|分|厘|斤|铢|株|枚|片|盏|升|合|g|克|ml|毫升|mg|丸|粒|滴|袋|字|匕";
const CN_NUM = "一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾";
// 阿拉伯数字剂量：6g / 23克 / 0.9克；古籍常写「1两半」「1钱2分」「1钱匕」，
// 故允许两个「数字+单位」相连，并允许单位后带「匕」
const DOSE_AR = new RegExp(`^(\\d+(?:\\.\\d+)?(?:${DOSE_UNIT})匕?(?:\\d+(?:\\.\\d+)?(?:${DOSE_UNIT})匕?)?半?)`);
// 模糊剂量：古方末味常写「麝香少许」「…适量」，作为剂量记录
const DOSE_VAGUE = /(少许|适量|酌量|若干|少量|不拘多少)$/;
// 残缺量词（源库偶见「…各两」）：仅在「各」之后才允许把单独单位当剂量，
// 否则「百合」的「合」会被误判成剂量
const DOSE_BARE = new RegExp(`^((?:${DOSE_UNIT})半?)`);
// 中文数字剂量：一两 / 半两 / 二钱半 / 一两半（数字或「半」必须出现，避免把「百合」误判成剂量）
const DOSE_CN = new RegExp(`^((?:[${CN_NUM}]+|半)半?(?:${DOSE_UNIT})半?)`);
// 药名（非贪婪）：遇 括号 / 阿拉伯数字 / 分隔符 / 中文数字+单位 / 「各」/ 结尾 即止
const NAME_RE = new RegExp(
  `^([\\u4e00-\\u9fa5]{1,10}?)(?=[（(]|\\d|[\\s、，,;；]|各|$|(?:[${CN_NUM}]+|半)半?(?:${DOSE_UNIT}))`
);
// 炮制/产地修饰：源库常写在药名前（炙甘草、酒生地黄、川大黄）或括号内（甘草（炙））
const DECOR_WORDS = ["炙", "炒", "蒸", "煅", "制", "生", "熟", "焦", "姜", "酒", "盐", "醋", "蜜", "炭", "霜", "飞", "嫩", "鲜", "干", "老", "陈", "黑", "大", "小", "白", "赤", "青", "黄", "川", "广", "云", "怀", "西", "浙", "杭", "甘", "山", "北", "南", "淮", "江", "真", "上"];

/**
 * 古方常用「处方名」→《中药学》正名（人工维护，用于把古方组成关联到药材条目）。
 * 例：古方多写「桂心」「生地」「归尾」，而药材条目名是「肉桂」「地黄」「当归」。
 * 若右侧正名不在药材库中，该映射会在建字典时自动跳过，绝不强行关联。
 */
const RX_ALIAS: Record<string, string> = {
  生地: "地黄", 熟地: "地黄", 大生地: "地黄", 生地黄: "地黄", 熟地黄: "地黄", 干地黄: "地黄", 熟干地黄: "地黄", 鲜地黄: "地黄", 小生地: "地黄",
  桂心: "肉桂", 官桂: "肉桂", 上桂: "肉桂", 桂: "肉桂", 桂皮: "肉桂",
  川椒: "花椒", 蜀椒: "花椒", 秦椒: "花椒",
  枸杞: "枸杞子", 甘枸杞: "枸杞子",
  归尾: "当归", 归身: "当归", 当归身: "当归", 全当归: "当归", 当归尾: "当归", 归头: "当归", 归须: "当归",
  干蝎: "全蝎", 全虫: "全蝎", 蝎梢: "全蝎", 蝎尾: "全蝎",
  枯矾: "白矾", 明矾: "白矾",
  广皮: "陈皮", 橘皮: "陈皮", 陈橘皮: "陈皮", 广陈皮: "陈皮", 新会皮: "陈皮",
  川大黄: "大黄", 锦纹大黄: "大黄", 锦纹: "大黄",
  川升麻: "升麻", 芎藭: "川芎", 川芎藭: "川芎", 川断: "续断", 川朴: "厚朴", 川楝: "川楝子",
  元参: "玄参", 元胡: "延胡索", 玄胡: "延胡索", 延胡: "延胡索", 玄胡索: "延胡索",
  银花: "金银花", 双花: "金银花", 二花: "金银花", 忍冬花: "金银花",
  白芍药: "白芍", 杭芍: "白芍", 杭白芍: "白芍", 芍药: "白芍", 赤芍药: "赤芍",
  云苓: "茯苓", 白茯苓: "茯苓", 赤茯苓: "茯苓",
  粉甘草: "甘草", 甘草梢: "甘草", 生甘草: "甘草", 炙甘草: "甘草",
  麦门冬: "麦冬", 天门冬: "天冬",
  怀牛膝: "牛膝", 川牛膝: "牛膝",
  真珠: "珍珠",
  广木香: "木香", 川木香: "木香", 青木香: "木香",
  汉防己: "防己", 木防己: "防己", 广防己: "防己",
  光杏仁: "苦杏仁",
  栝楼: "瓜蒌", 栝蒌根: "天花粉", 瓜蒌根: "天花粉", 花粉: "天花粉",
  破故纸: "补骨脂", 故纸: "补骨脂",
  坤草: "益母草",
  田七: "三七", 参三七: "三七",
  龙脑: "冰片", 梅片: "冰片",
  桑皮: "桑白皮", 牡丹: "牡丹皮", 小茴: "小茴香", 牙消: "芒硝",
  麒麟竭: "血竭", 陈曲: "神曲", 甜葶苈: "葶苈子", 香油: "麻油",
  海蛤: "蛤壳", 虎胫骨: "虎骨",
};
const BRACKET_HEAD = /^[（(]([^）)]*)[）)]/;

interface RawItem {
  name: string;
  note: string;
  dosage: string;
  ge: boolean; // 该味是否带「各」（与前一味共用剂量）
}

// 归一化：去 HTML 实体、压缩空白
function norm(s: any): string {
  return decodeEntities(String(s ?? "")).replace(/\s+/g, " ").trim();
}

// 药名 → 药材 ID：精确 → 逐层剥离炮制/产地前缀 → 剥离常见后缀 → 未匹配则保留原文
function matchHerb(rawName: string): { id: number | null; name: string; note: string } {
  const name = rawName.trim();
  if (!name) return { id: null, name, note: "" };
  if (HERB_DICT.has(name)) return { id: HERB_DICT.get(name)!, name, note: "" };
  // 逐层剥离前缀（酒生地黄 → 生地黄 → 地黄；川大黄 → 大黄），剥到命中为止
  let cur = name;
  let acc = "";
  for (let lv = 0; lv < 4; lv++) {
    let hit = "";
    for (const w of DECOR_WORDS) {
      if (cur.length > 1 && cur.startsWith(w)) { hit = w; break; }
    }
    if (!hit) break;
    cur = cur.slice(hit.length);
    acc = acc ? `${acc}、${hit}` : hit;
    if (HERB_DICT.has(cur)) return { id: HERB_DICT.get(cur)!, name: cur, note: acc };
  }
  for (const suf of ["片", "炭", "膏", "粉", "汁", "油", "霜", "胶", "末", "绒", "节", "根", "叶", "皮", "子", "仁", "穗", "心", "尾", "身", "尖", "壳", "核", "肉", "骨", "角", "屑"]) {
    if (name.length > 1 && name.endsWith(suf)) {
      const rest = name.slice(0, -suf.length);
      if (rest && HERB_DICT.has(rest)) return { id: HERB_DICT.get(rest)!, name: rest, note: suf };
    }
  }
  return { id: null, name, note: "" };
}

// 按分隔符切分，但跳过括号内内容（古方括号里常含顿号与逗号）
function splitOutside(text: string, seps: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of text) {
    if (ch === "（" || ch === "(") depth++;
    else if (ch === "）" || ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && seps.includes(ch)) { out.push(buf); buf = ""; }
    else buf += ch;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

function takeDose(s: string, allowBare = false): { dose: string; rest: string } {
  const m = s.match(DOSE_AR) || s.match(DOSE_CN) || (allowBare ? s.match(DOSE_BARE) : null);
  if (!m || !m[1]) return { dose: "", rest: s };
  return { dose: m[1], rest: s.slice(m[0].length) };
}

// 括号内容：按 . ，、 切分，含剂量的部分作用量，其余作炮制标注
function splitBracket(inner: string): { note: string; dosage: string } {
  let dosage = "";
  const notes: string[] = [];
  for (const p of inner.split(/[.。，、]/).map((s) => s.trim()).filter(Boolean)) {
    const m = p.match(DOSE_CN) || p.match(DOSE_AR);
    if (m && m[1] && m[1].length >= p.length - 1) dosage = dosage || m[1];
    else notes.push(p);
  }
  return { note: notes.join("、"), dosage };
}

// 扫描一个片段：药名 [括号…] [各] 剂量，可处理粘连写法（如「阿胶23克（捣碎）白茯苓23克」）
function scanBlock(block: string): RawItem[] {
  const items: RawItem[] = [];
  let rest = block;
  let guard = 0;
  while (rest && guard++ < 40) {
    // 以括号开头：归属上一项（古方常把括号与下一味药连写）
    let bm: RegExpExecArray | null;
    while ((bm = BRACKET_HEAD.exec(rest))) {
      const { note, dosage } = splitBracket(bm[1]!);
      const last = items[items.length - 1];
      if (last) {
        if (dosage && !last.dosage) last.dosage = dosage;
        if (note) last.note = last.note ? `${last.note}、${note}` : note;
      }
      rest = rest.slice(bm[0].length);
    }
    if (!rest) break;
    if (/^各/.test(rest)) { rest = rest.slice(1); continue; } // 「各X」块由上层处理
    const nm = NAME_RE.exec(rest);
    if (!nm || !nm[1]) break;
    let itemName = nm[1];
    let vague = "";
    const vm = DOSE_VAGUE.exec(itemName);
    if (vm && vm[1]) {
      vague = vm[1];
      itemName = itemName.slice(0, -vague.length);
    }
    const item: RawItem = { name: itemName, note: "", dosage: vague, ge: false };
    rest = rest.slice(nm[1].length);
    while ((bm = BRACKET_HEAD.exec(rest))) {
      const { note, dosage } = splitBracket(bm[1]!);
      if (dosage && !item.dosage) item.dosage = dosage;
      if (note) item.note = item.note ? `${item.note}、${note}` : note;
      rest = rest.slice(bm[0].length);
    }
    if (/^各/.test(rest)) { item.ge = true; rest = rest.slice(1); }
    const d = takeDose(rest, item.ge);
    if (d.dose) {
      if (!item.dosage) item.dosage = d.dose;
      rest = d.rest;
    }
    items.push(item);
  }
  return items;
}

/**
 * 解析组成原文（ChuFang）。源库主要有三种写法：
 *   ① 药典式：「麻黄（去节）6g 桂枝4g 杏仁（去皮尖）9g 甘草（炙）3g」（用量在括号外）
 *   ② 古方式：「牛黄（研.二钱半） 干蝎（炒.半两）」（用量在括号内，以「.」与炮制分隔）
 *   ③ 共用剂量式：「琥珀（研）、珍珠（研）…、龙齿（研），各一两」或「生甘草 炙甘草各6克」
 * 无法解析或匹配不上药材表的条目仍保留原文（herbId 为 null），保证原文不丢失。
 */
export function parseComposition(chuFang: any): CompositionRow[] {
  const text = norm(chuFang);
  if (!text) return [];
  const raw: RawItem[] = [];
  for (const seg of splitOutside(text, "。；;")) {
    const segItems: RawItem[] = [];
    let shared = "";
    for (const block of splitOutside(seg, " \t、，,")) {
      // 「等分」：古方表示各味份量相同，作为共用剂量，不当药名。
      // 常见写法「…，（已上）各等分」，前缀多为套话，只保留其中的药名
      if (/等分$/.test(block)) {
        shared = "等分";
        const pre = block.replace(/(?:各)?等分$/, "");
        if (pre && !/^(已上|以上|右|用|共|为末|同|均|俱|上)$/.test(pre)) segItems.push(...scanBlock(pre));
        continue;
      }
      const ge = /^各\s*(.+)$/.exec(block);
      if (ge) { shared = ge[1]!.trim(); continue; }
      segItems.push(...scanBlock(block));
    }
    // 源数据中偶见药名被空格拆开（「…白及 半 夏 穿山甲…」）：
    // 仅当相邻两项都无剂量、且合并后能在药材库中命中时才合并，避免误并
    for (let i = 0; i < segItems.length - 1; i++) {
      const a = segItems[i]!;
      const b = segItems[i + 1]!;
      if (a.dosage || b.dosage || a.ge || b.ge) continue;
      if (HERB_DICT.has(a.name + b.name)) {
        a.name = a.name + b.name;
        a.note = [a.note, b.note].filter(Boolean).join("、");
        segItems.splice(i + 1, 1);
        i--;
      }
    }
    // 「，各一两」式：整段共用剂量
    if (shared) for (const it of segItems) if (!it.dosage) it.dosage = shared;
    // 「X Y 各6克」式：从后往前把剂量补给前面连续无剂量的味
    for (let i = segItems.length - 1; i >= 0; i--) {
      const it = segItems[i]!;
      if (it.ge && it.dosage) {
        for (let j = i - 1; j >= 0; j--) {
          if (segItems[j]!.dosage) break;
          segItems[j]!.dosage = it.dosage;
        }
      }
    }
    raw.push(...segItems);
  }
  return raw
    .filter((r) => r.name)
    // 制剂叙述套话（「生用为末」「炼蜜为丸」「共研细末」）不是药名，剔除
    .filter((r) => !/为(末|丸|散|膏|丹|汤|锭|饼)|煎服|冲服|送服|调服|细末|水煎|蜜丸/.test(r.name))
    .slice(0, 60)
    .map((r) => {
      const m = matchHerb(r.name);
      return {
        herbId: m.id,
        name: m.name || r.name,
        note: [m.note, r.note].filter(Boolean).join("、"),
        dosage: r.dosage,
        raw: `${r.name}${r.note ? `（${r.note}）` : ""}${r.dosage}`.trim(),
        matched: m.id != null,
      };
    });
}

export function serializeComposition(rows: { name: string; note?: string; dosage?: string }[]): string {
  return rows
    .map((r) => {
      const note = r.note ? `（${r.note}）` : "";
      return `${r.name}${note}${r.dosage ?? ""}`.trim();
    })
    .filter(Boolean)
    .join(" ");
}

// ===== 出处归一化（facet 用）=====
export function normalizeOrigin(zhaiLu: any): string {
  const t = norm(zhaiLu);
  if (!t) return "未标注";
  if (/中国药典/.test(t)) return "中国药典";
  if (/部颁|局颁|标准/.test(t)) return "颁行标准";
  const m = t.match(/《([^》]{1,24})》/);
  if (m) {
    if (/伤寒论|金匮|内经|神农本草|温病条辨|难经|温疫论|伤寒/.test(m[1]!)) return "经典古籍";
    return "其他典籍";
  }
  if (/方剂学|中药学|中医/.test(t)) return "教材专著";
  return "其他";
}

// 拼音首字母（源方剂 PinYin 列基本为空，故用 PYFile，如 mahuangtang → M）
export function letterOf(pinyin: string, pyFile: string): string {
  const p = (pinyin || pyFile || "").trim();
  const c = p.slice(0, 1).toUpperCase();
  return /[A-Z]/.test(c) ? c : "";
}

// ===== 元信息（供列表筛选/排序，避免每次全量计算）=====
export function saveMeta(key: string, custom: boolean, m: {
  MingCheng: string; PinYin: string; letter: string; effect: string; origin: string; herbCount: number;
}) {
  rx.query(
    `INSERT INTO rx_meta (rxKey, custom, state, MingCheng, PinYin, letter, effect, origin, herbCount, updatedAt)
     VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(rxKey) DO UPDATE SET
       custom = excluded.custom, MingCheng = excluded.MingCheng, PinYin = excluded.PinYin,
       letter = excluded.letter, effect = excluded.effect, origin = excluded.origin,
       herbCount = excluded.herbCount, updatedAt = excluded.updatedAt`
  ).run(key, custom ? 1 : 0, m.MingCheng, m.PinYin, m.letter, m.effect, m.origin, m.herbCount, Date.now());
}

export function saveHerbs(key: string, kind: 0 | 1, rows: CompositionRow[]) {
  rx.query("DELETE FROM rx_herbs WHERE rxKey = ? AND kind = ?").run(key, kind);
  const stmt = rx.prepare(
    "INSERT INTO rx_herbs (rxKey, kind, seq, herbId, name, note, dosage, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  rows.forEach((r, i) => stmt.run(key, kind, i, r.herbId, r.name, r.note || "", r.dosage || "", r.raw || ""));
}

// ===== 查询：列表 =====
export interface RxQuery {
  q?: string;
  letter?: string;
  origin?: string;
  effect?: string;
  herbId?: number | string;
  page?: number;
  pageSize?: number;
}

export interface PrescriptionItem {
  id: string;
  custom: boolean;
  title: string;
  pinyin: string;
  subtitle: string;   // 组成摘要
  gongneng: string;   // 功能主治
  origin: string;
  effect: string;
  herbCount: number;
}

export interface RxFacets {
  letters: { letter: string; count: number }[];
  origins: { value: string; count: number }[];
  effects: { value: string; count: number }[];
}

export interface PrescriptionResult {
  total: number;
  page: number;
  pageSize: number;
  items: PrescriptionItem[];
  facets: RxFacets;
}

// 取某页的源方剂明细（源库只读）
async function fetchSourceRows(ids: number[]): Promise<Map<number, any>> {
  const map = new Map<number, any>();
  if (ids.length === 0) return map;
  const ph = ids.map(() => "?").join(",");
  const rows = await queryRows<any>(
    `SELECT ID, MingCheng, PYFile, PinYinZT, BieMing, ZhaiLu, ChuFang, YongFaYL, GongNengZZ, ZhuYi, BeiZhu, PaoZhi
     FROM zysjyj WHERE TypeID = 39 AND ID IN (${ph})`,
    ids
  );
  for (const r of rows) map.set(Number(r.ID), r);
  return map;
}

// 组成摘要：前 n 味「药名+用量」
function compositionBrief(rows: { name: string; dosage: string }[], n = 3): string {
  const parts = rows.slice(0, n).map((r) => `${r.name}${r.dosage || ""}`);
  const s = parts.join("、");
  return rows.length > n ? `${s} 等 ${rows.length} 味` : s || "组成未标注";
}

function metaToItem(
  m: { rxKey: string; custom: number; MingCheng: string; PinYin: string; effect: string; origin: string; herbCount: number },
  comp: { name: string; dosage: string }[],
  gongneng: string
): PrescriptionItem {
  return {
    id: m.rxKey,
    custom: m.custom === 1,
    title: m.MingCheng,
    pinyin: m.PinYin || "",
    subtitle: compositionBrief(comp, 3),
    gongneng: excerpt(gongneng, 90),
    origin: m.origin,
    effect: m.effect,
    herbCount: m.herbCount,
  };
}

export async function listPrescriptions(opts: RxQuery): Promise<PrescriptionResult> {
  await ensureHerbDict();
  const page = Math.max(1, opts.page || 1);
  const pageSize = opts.pageSize || 18;
  const where: string[] = ["state = 0"];
  const args: any[] = [];
  const condCustom = (custom: 0 | 1) => {
    const w = [...where, "custom = ?"];
    const a = [...args, custom];
    return { w, a };
  };

  // 关键词：名称 / 拼音 / 组成药材名（在 rx_herbs 中回查）
  let keyFilter = "";
  let keyArgs: any[] = [];
  if (opts.q) {
    const like = `%${opts.q}%`;
    const herbKeys = rx
      .query("SELECT DISTINCT rxKey FROM rx_herbs WHERE name LIKE ?")
      .all(like) as { rxKey: string }[];
    const placeholders = herbKeys.map((_, i) => `?`).join(",");
    keyFilter = ` AND (MingCheng LIKE ? OR PinYin LIKE ?${herbKeys.length ? ` OR rxKey IN (${placeholders})` : ""})`;
    keyArgs = [like, like, ...herbKeys.map((h) => h.rxKey)];
  }
  if (opts.letter) { where.push("letter = ?"); args.push(opts.letter.toUpperCase()); }
  if (opts.origin) { where.push("origin = ?"); args.push(opts.origin); }
  if (opts.effect) { where.push("effect = ?"); args.push(opts.effect); }
  if (opts.herbId) {
    // 展开同名药材 ID：药材表存在重名条目，只按单个 ID 查询会漏掉
    const ids = herbIdGroup(Number(opts.herbId));
    const idPh = ids.map(() => "?").join(",");
    const keys = ids.length
      ? (rx.query(`SELECT DISTINCT rxKey FROM rx_herbs WHERE herbId IN (${idPh})`).all(...ids) as { rxKey: string }[])
      : [];
    const ph = keys.map(() => "?").join(",");
    where.push(keys.length ? `rxKey IN (${ph})` : "1 = 0");
    args.push(...keys.map((k) => k.rxKey));
  }

  const c1 = condCustom(1);
  const c0 = condCustom(0);
  const order = " ORDER BY MingCheng, rxKey";

  const customAll = rx
    .query(`SELECT rxKey, custom, MingCheng, PinYin, effect, origin, herbCount FROM rx_meta WHERE ${c1.w.join(" AND ")}${keyFilter}${order}`)
    .all(...c1.a, ...keyArgs) as any[];
  const totalCustom = Number(
    (rx.query(`SELECT COUNT(*) AS c FROM rx_meta WHERE ${c1.w.join(" AND ")}${keyFilter}`).get(...c1.a, ...keyArgs) as any)?.c ?? 0
  );
  const totalSource = Number(
    (rx.query(`SELECT COUNT(*) AS c FROM rx_meta WHERE ${c0.w.join(" AND ")}${keyFilter}`).get(...c0.a, ...keyArgs) as any)?.c ?? 0
  );
  const total = totalCustom + totalSource;

  const offset = (page - 1) * pageSize;
  // 混排分页：自建汤方恒在最前（数量少），其后为源方剂
  let customPage: any[] = [];
  let sourceOffset = 0;
  let sourceLimit = pageSize;
  if (offset < customAll.length) {
    customPage = customAll.slice(offset, offset + pageSize);
    sourceLimit = pageSize - customPage.length;
  } else {
    sourceOffset = offset - customAll.length;
  }
  const sourcePage = sourceLimit > 0
    ? (rx
        .query(
          `SELECT rxKey, custom, MingCheng, PinYin, effect, origin, herbCount FROM rx_meta WHERE ${c0.w.join(" AND ")}${keyFilter}${order} LIMIT ? OFFSET ?`
        )
        .all(...c0.a, ...keyArgs, sourceLimit, sourceOffset) as any[])
    : [];

  const pageMetas = [...customPage, ...sourcePage];
  // 组成与功能主治：组成批量取，功能主治源方剂从源库取、自建从 rx_custom 取
  const keys = pageMetas.map((m) => m.rxKey as string);
  const compMap = new Map<string, { name: string; dosage: string }[]>();
  if (keys.length) {
    const ph = keys.map(() => "?").join(",");
    const rows = rx
      .query(
        `SELECT rxKey, name, dosage, kind FROM rx_herbs WHERE rxKey IN (${ph}) AND kind = CASE WHEN EXISTS (SELECT 1 FROM rx_herbs h2 WHERE h2.rxKey = rx_herbs.rxKey AND h2.kind = 1) THEN 1 ELSE 0 END ORDER BY seq`
      )
      .all(...keys) as any[];
    for (const r of rows) {
      const list = compMap.get(r.rxKey) ?? [];
      list.push({ name: r.name, dosage: r.dosage });
      compMap.set(r.rxKey, list);
    }
  }
  const srcIds: number[] = [];
  const customIds: number[] = [];
  for (const k of keys) {
    if (k.startsWith("s")) srcIds.push(Number(k.slice(1)));
    else if (k.startsWith("c")) customIds.push(Number(k.slice(1)));
  }
  const srcRows = await fetchSourceRows(srcIds);
  const customRows = new Map<number, any>();
  if (customIds.length) {
    const ph = customIds.map(() => "?").join(",");
    for (const r of rx.query(`SELECT * FROM rx_custom WHERE id IN (${ph})`).all(...customIds) as any[]) {
      customRows.set(Number(r.id), r);
    }
  }

  const items: PrescriptionItem[] = pageMetas.map((m) => {
    const comp = compMap.get(m.rxKey) ?? [];
    let gongneng = "";
    if (m.rxKey.startsWith("s")) {
      const r = srcRows.get(Number(String(m.rxKey).slice(1)));
      gongneng = r?.GongNengZZ ?? "";
    } else {
      const r = customRows.get(Number(String(m.rxKey).slice(1)));
      gongneng = r?.GongNengZZ ?? "";
    }
    return metaToItem(m, comp, gongneng);
  });

  return { total, page, pageSize, items, facets: rxFacets() };
}

// 分类统计（基于 rx_meta，整表 5 万行级，单独缓存）
export function rxFacets(): RxFacets {
  const letters = rx
    .query(`SELECT letter AS v, COUNT(*) AS c FROM rx_meta WHERE state = 0 AND letter <> '' GROUP BY letter ORDER BY letter`)
    .all() as { v: string; c: number }[];
  const origins = rx
    .query(`SELECT origin AS v, COUNT(*) AS c FROM rx_meta WHERE state = 0 GROUP BY origin ORDER BY c DESC`)
    .all() as { v: string; c: number }[];
  const effects = rx
    .query(`SELECT effect AS v, COUNT(*) AS c FROM rx_meta WHERE state = 0 GROUP BY effect ORDER BY c DESC`)
    .all() as { v: string; c: number }[];
  return {
    letters: letters.map((r) => ({ letter: r.v, count: r.c })),
    origins: origins.map((r) => ({ value: r.v, count: r.c })),
    effects: effects.map((r) => ({ value: r.v, count: r.c })),
  };
}

// ===== 查询：详情 =====
export interface PrescriptionDetail {
  id: string;
  custom: boolean;
  title: string;
  pinyin: string;
  alias: string;
  origin: string;
  effect: string;
  effectConfidence: string;
  // 五个核心模块
  composition: CompositionRow[];
  usage: string;      // 煎煮与服用方法（YongFaYL）
  gongneng: string;   // 功效与适应症（GongNengZZ）
  taboo: string;      // 禁忌（ZhuYi）
  remark: string;     // 备注（BeiZhu）
  prep: string;       // 制法/炮制（PaoZhi，可作煎煮补充）
  groups: { group: string; fields: { label: string; value: string }[] }[];
  // 可编辑信息
  editable: boolean;
  isOverridden: boolean;
  updatedAt: number | null;
}

export async function getPrescription(id: string): Promise<PrescriptionDetail | null> {
  await ensureHerbDict();
  const { kind, num } = parseRxId(id);
  if (!kind || !num) return null;

  if (kind === "c") {
    const r = rx.query("SELECT * FROM rx_custom WHERE id = ?").get(num) as any;
    if (!r) return null;
    const comp = (rx
      .query("SELECT herbId, name, note, dosage, raw FROM rx_herbs WHERE rxKey = ? AND kind = 1 ORDER BY seq")
      .all(id) as any[]).map((h) => ({
        herbId: h.herbId ?? null,
        name: h.name,
        note: h.note || "",
        dosage: h.dosage || "",
        raw: h.raw || "",
        matched: h.herbId != null,
      }));
    const eff = detectEffect(norm(r.GongNengZZ));
    return {
      id,
      custom: true,
      title: norm(r.MingCheng),
      pinyin: norm(r.PinYin),
      alias: norm(r.BieMing),
      origin: norm(r.ZhaiLu),
      effect: eff.effect,
      effectConfidence: eff.confidence,
      composition: comp,
      usage: norm(r.YongFaYL),
      gongneng: norm(r.GongNengZZ),
      taboo: norm(r.ZhuYi),
      remark: norm(r.BeiZhu),
      prep: norm(r.PaoZhi),
      groups: buildGroups({ ...r, MingCheng: norm(r.MingCheng) }, true),
      editable: true,
      isOverridden: false,
      updatedAt: r.updatedAt ?? null,
    };
  }

  // 源方剂：源库只读 + 覆盖层合并 + 删除名单
  const deleted = rx.query("SELECT 1 FROM rx_deleted WHERE sourceId = ?").get(num);
  if (deleted) return null;
  const row = await queryOne<any>(
    `SELECT ID, MingCheng, PYFile, PinYinZT, BieMing, ZhaiLu, ChuFang, YongFaYL, GongNengZZ, ZhuYi, BeiZhu, PaoZhi
     FROM zysjyj WHERE TypeID = 39 AND ID = ?`,
    [num]
  );
  if (!row) return null;
  const ov = rx.query("SELECT * FROM rx_overrides WHERE sourceId = ?").get(num) as any;
  const merged: Record<string, string> = {
    MingCheng: norm(ov?.MingCheng || row.MingCheng),
    PinYin: norm(ov?.PinYin || row.PYFile || row.PinYinZT),
    BieMing: norm(ov?.BieMing || row.BieMing),
    ZhaiLu: norm(ov?.ZhaiLu || row.ZhaiLu),
    ChuFang: norm(ov?.ChuFang || row.ChuFang),
    YongFaYL: norm(ov?.YongFaYL || row.YongFaYL),
    GongNengZZ: norm(ov?.GongNengZZ || row.GongNengZZ),
    ZhuYi: norm(ov?.ZhuYi || row.ZhuYi),
    BeiZhu: norm(ov?.BeiZhu || row.BeiZhu),
    PaoZhi: norm(ov?.PaoZhi || row.PaoZhi),
  };
  // 组成：用户改过（kind=1）则用用户版本，否则用解析结果（kind=0）
  let comp = (rx
    .query("SELECT herbId, name, note, dosage, raw FROM rx_herbs WHERE rxKey = ? AND kind = 1 ORDER BY seq")
    .all(id) as any[]).map(toCompRow);
  if (comp.length === 0) {
    comp = (rx
      .query("SELECT herbId, name, note, dosage, raw FROM rx_herbs WHERE rxKey = ? AND kind = 0 ORDER BY seq")
      .all(id) as any[]).map(toCompRow);
  }
  const eff = detectEffect(merged.GongNengZZ);
  return {
    id,
    custom: false,
    title: merged.MingCheng,
    pinyin: merged.PinYin,
    alias: merged.BieMing,
    origin: merged.ZhaiLu,
    effect: eff.effect,
    effectConfidence: eff.confidence,
    composition: comp,
    usage: merged.YongFaYL,
    gongneng: merged.GongNengZZ,
    taboo: merged.ZhuYi,
    remark: merged.BeiZhu,
    prep: merged.PaoZhi,
    groups: buildGroups(merged, false),
    editable: true,
    isOverridden: !!ov,
    updatedAt: ov?.updatedAt ?? null,
  };
}

function toCompRow(h: any): CompositionRow {
  return {
    herbId: h.herbId ?? null,
    name: h.name,
    note: h.note || "",
    dosage: h.dosage || "",
    raw: h.raw || "",
    matched: h.herbId != null,
  };
}

// 详情分组：沿用中药材模块的分组命名（基本信息 / 药性功效 / 现代研究 → 汤方为 基本信息 / 组成用法 / 备注摘录）
function buildGroups(m: Record<string, string>, custom: boolean) {
  const groups = [
    {
      group: "基本信息",
      fields: [
        { label: "名称", value: m.MingCheng },
        { label: "拼音", value: m.PinYin },
        { label: "别名", value: m.BieMing },
        { label: "出处", value: m.ZhaiLu },
      ].filter((f) => f.value) as { label: string; value: string }[],
    },
    {
      group: "组成与用法",
      fields: [
        { label: "组成", value: m.ChuFang },
        { label: "制法", value: m.PaoZhi },
        { label: "用法用量", value: m.YongFaYL },
      ].filter((f) => f.value) as { label: string; value: string }[],
    },
    {
      group: "功效与宜忌",
      fields: [
        { label: "功能主治", value: m.GongNengZZ },
        { label: "禁忌", value: m.ZhuYi },
        { label: "备注", value: m.BeiZhu },
      ].filter((f) => f.value) as { label: string; value: string }[],
    },
  ];
  return groups.filter((g) => g.fields.length > 0);
}

export function parseRxId(id: string): { kind: "s" | "c" | null; num: number | null } {
  const m = /^([sc])(\d+)$/.exec(id || "");
  if (!m) return { kind: null, num: null };
  return { kind: m[1] as "s" | "c", num: Number(m[2]) };
}

// ===== 写入：新建 / 更新 / 删除 =====
export interface RxInput {
  MingCheng: string;
  PinYin?: string;
  BieMing?: string;
  ZhaiLu?: string;
  ChuFang?: string;      // 组成原文（若传 composition 则以 composition 序列化为准）
  YongFaYL?: string;
  GongNengZZ?: string;
  ZhuYi?: string;
  BeiZhu?: string;
  PaoZhi?: string;
  composition?: { name: string; note?: string; dosage?: string; herbId?: number | null }[];
}

export interface RxValidation {
  ok: boolean;
  errors: string[];
}

// 校验规则（与中药材保持同样的「必填 + 长度 + 格式」风格）：
//   - 名称必填且不超长
//   - 组成至少 1 味，药名必填不超长，用量须为「数字 + 可选单位」或留空
//   - 长文本字段限制长度，避免超长内容入库
export function validateRx(input: RxInput): RxValidation {
  const errors: string[] = [];
  const name = (input.MingCheng || "").trim();
  if (!name) errors.push("汤方名称不能为空");
  else if (name.length > 60) errors.push("汤方名称不能超过 60 个字符");

  const comp = (input.composition ?? []).filter((c) => (c.name || "").trim());
  if (comp.length === 0) errors.push("组成至少需要 1 味药材");
  if (comp.length > 60) errors.push("组成药材最多 60 味");
  for (const c of comp) {
    if ((c.name || "").trim().length > 30) errors.push(`组成药材名「${(c.name || "").slice(0, 10)}…」超过 30 个字符`);
    const d = (c.dosage || "").trim();
    if (d && !/^\d+(\.\d+)?\s*(g|克|ml|毫升|mg|钱|两|分|枚|片|粒|丸|滴|袋|付|剂)?$/.test(d)) {
      errors.push(`用量「${d}」格式不正确，应为数字加单位（如 6g、9克）或留空`);
    }
  }
  const longFields: [string, string, number][] = [
    ["GongNengZZ", "功效与适应症", 2000],
    ["YongFaYL", "煎煮与服用方法", 2000],
    ["ZhuYi", "禁忌", 1000],
    ["BeiZhu", "备注", 1000],
    ["PaoZhi", "制法", 2000],
    ["ChuFang", "组成原文", 2000],
  ];
  for (const [key, label, max] of longFields) {
    const v = (input as any)[key];
    if (v && String(v).length > max) errors.push(`${label}不能超过 ${max} 个字符`);
  }
  for (const [key, label, max] of [["PinYin", "拼音", 60], ["BieMing", "别名", 200], ["ZhaiLu", "出处", 200]] as [string, string, number][]) {
    const v = (input as any)[key];
    if (v && String(v).length > max) errors.push(`${label}不能超过 ${max} 个字符`);
  }
  return { ok: errors.length === 0, errors };
}

// 组成行 → 入库结构（顺带补算 herbId，用户手输的药名也尽量关联）
function normalizeComposition(rows: RxInput["composition"]): CompositionRow[] {
  return (rows ?? [])
    .filter((c) => (c.name || "").trim())
    .map((c) => {
      const rawName = String(c.name || "").trim();
      const m = c.herbId != null ? { id: Number(c.herbId), name: rawName, note: "" } : matchHerb(rawName);
      return {
        herbId: m.id ?? null,
        name: m.name || rawName,
        note: c.note ? String(c.note).trim() : m.note || "",
        dosage: String(c.dosage || "").trim(),
        raw: `${rawName}${c.note ? `（${c.note}）` : ""}${c.dosage || ""}`.trim(),
        matched: m.id != null,
      };
    });
}

function derivedMeta(input: RxInput, comp: CompositionRow[]) {
  const gong = String(input.GongNengZZ || "").trim();
  const eff = detectEffect(gong);
  const pinyin = String(input.PinYin || "").trim();
  const name = String(input.MingCheng || "").trim();
  return {
    MingCheng: name,
    PinYin: pinyin,
    letter: letterOf(pinyin, pinyin || ""),
    effect: eff.effect,
    origin: normalizeOrigin(input.ZhaiLu),
    herbCount: comp.length,
  };
}

export async function createPrescription(input: RxInput): Promise<{ id: string }> {
  await ensureHerbDict();
  const comp = normalizeComposition(input.composition);
  const chuFang = String(input.ChuFang || "").trim() || serializeComposition(comp);
  const now = Date.now();
  const info = rx
    .query(
      `INSERT INTO rx_custom (MingCheng, PinYin, BieMing, ZhaiLu, ChuFang, YongFaYL, GongNengZZ, ZhuYi, BeiZhu, PaoZhi, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(input.MingCheng || "").trim(),
      String(input.PinYin || "").trim(),
      String(input.BieMing || "").trim(),
      String(input.ZhaiLu || "").trim(),
      chuFang,
      String(input.YongFaYL || "").trim(),
      String(input.GongNengZZ || "").trim(),
      String(input.ZhuYi || "").trim(),
      String(input.BeiZhu || "").trim(),
      String(input.PaoZhi || "").trim(),
      now,
      now
    );
  const cid = Number(info.lastInsertRowid);
  const key = `c${cid}`;
  saveHerbs(key, 1, comp);
  saveMeta(key, true, derivedMeta(input, comp));
  return { id: key };
}

export async function updatePrescription(id: string, input: RxInput): Promise<{ ok: boolean; reason?: string }> {
  await ensureHerbDict();
  const { kind, num } = parseRxId(id);
  if (!kind || !num) return { ok: false, reason: "汤方 id 无效" };
  const now = Date.now();
  const comp = normalizeComposition(input.composition);
  const chuFang = String(input.ChuFang || "").trim() || serializeComposition(comp);

  if (kind === "c") {
    const exists = rx.query("SELECT id FROM rx_custom WHERE id = ?").get(num);
    if (!exists) return { ok: false, reason: "汤方不存在" };
    rx.query(
      `UPDATE rx_custom SET MingCheng = ?, PinYin = ?, BieMing = ?, ZhaiLu = ?, ChuFang = ?,
       YongFaYL = ?, GongNengZZ = ?, ZhuYi = ?, BeiZhu = ?, PaoZhi = ?, updatedAt = ? WHERE id = ?`
    ).run(
      String(input.MingCheng || "").trim(),
      String(input.PinYin || "").trim(),
      String(input.BieMing || "").trim(),
      String(input.ZhaiLu || "").trim(),
      chuFang,
      String(input.YongFaYL || "").trim(),
      String(input.GongNengZZ || "").trim(),
      String(input.ZhuYi || "").trim(),
      String(input.BeiZhu || "").trim(),
      String(input.PaoZhi || "").trim(),
      now,
      num
    );
    saveHerbs(id, 1, comp);
    saveMeta(id, true, derivedMeta(input, comp));
    return { ok: true };
  }

  // 源方剂：不改动源库，写入覆盖层（只存实际提交的字段，便于与源值区分）
  const row = await queryOne<any>(
    "SELECT ID, MingCheng, PYFile, PinYinZT, ZhaiLu, GongNengZZ FROM zysjyj WHERE TypeID = 39 AND ID = ?",
    [num]
  );
  if (!row) return { ok: false, reason: "汤方不存在" };
  const deleted = rx.query("SELECT 1 FROM rx_deleted WHERE sourceId = ?").get(num);
  if (deleted) return { ok: false, reason: "该汤方已被删除" };
  rx.query(
    `INSERT INTO rx_overrides (sourceId, MingCheng, PinYin, BieMing, ZhaiLu, ChuFang, YongFaYL, GongNengZZ, ZhuYi, BeiZhu, PaoZhi, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sourceId) DO UPDATE SET
       MingCheng = excluded.MingCheng, PinYin = excluded.PinYin, BieMing = excluded.BieMing,
       ZhaiLu = excluded.ZhaiLu, ChuFang = excluded.ChuFang, YongFaYL = excluded.YongFaYL,
       GongNengZZ = excluded.GongNengZZ, ZhuYi = excluded.ZhuYi, BeiZhu = excluded.BeiZhu,
       PaoZhi = excluded.PaoZhi, updatedAt = excluded.updatedAt`
  ).run(
    num,
    String(input.MingCheng || "").trim(),
    String(input.PinYin || "").trim(),
    String(input.BieMing || "").trim(),
    String(input.ZhaiLu || "").trim(),
    chuFang,
    String(input.YongFaYL || "").trim(),
    String(input.GongNengZZ || "").trim(),
    String(input.ZhuYi || "").trim(),
    String(input.BeiZhu || "").trim(),
    String(input.PaoZhi || "").trim(),
    now
  );
  saveHerbs(id, 1, comp);
  // 元信息按「覆盖层 + 源值回退」的合并结果计算，与详情页读取口径一致：
  // 用户清空某字段时，该字段仍显示源库值，故列表不能按空值推导（否则功效会变成「其他」）。
  saveMeta(
    id,
    false,
    derivedMeta(
      {
        MingCheng: String(input.MingCheng || "").trim() || norm(row.MingCheng),
        PinYin: String(input.PinYin || "").trim() || (norm(row.PYFile) || norm(row.PinYinZT)),
        GongNengZZ: String(input.GongNengZZ || "").trim() || norm(row.GongNengZZ),
        ZhaiLu: String(input.ZhaiLu || "").trim() || norm(row.ZhaiLu),
      },
      comp
    )
  );
  return { ok: true };
}

// 删除：自建物理删除；源方剂进入隐藏名单（源库不动），支持恢复
export async function deletePrescription(id: string): Promise<{ ok: boolean; reason?: string }> {
  const { kind, num } = parseRxId(id);
  if (!kind || !num) return { ok: false, reason: "汤方 id 无效" };
  if (kind === "c") {
    const r = rx.query("DELETE FROM rx_custom WHERE id = ?").run(num);
    rx.query("DELETE FROM rx_herbs WHERE rxKey = ?").run(id);
    rx.query("DELETE FROM rx_meta WHERE rxKey = ?").run(id);
    return r.changes > 0 ? { ok: true } : { ok: false, reason: "汤方不存在" };
  }
  const row = await queryOne<any>("SELECT ID FROM zysjyj WHERE TypeID = 39 AND ID = ?", [num]);
  if (!row) return { ok: false, reason: "汤方不存在" };
  rx.query("INSERT OR IGNORE INTO rx_deleted (sourceId) VALUES (?)").run(num);
  rx.query("UPDATE rx_meta SET state = 1 WHERE rxKey = ?").run(id);
  // 注意：这里**不删除** rx_overrides。删除只是隐藏（state=1），用户此前对该方剂的改写
  // 必须保留，否则「撤销删除（restore）」会连带丢掉改写内容，撤销就不再是真正的撤销。
  // 想丢弃改写内容，走「还原原值（reset）」。
  return { ok: true };
}

// 恢复：仅对源方剂生效（自建删除后不可恢复）
export async function restorePrescription(id: string): Promise<{ ok: boolean; reason?: string }> {
  const { kind, num } = parseRxId(id);
  if (kind !== "s" || !num) return { ok: false, reason: "仅源库汤方支持恢复" };
  const r = rx.query("DELETE FROM rx_deleted WHERE sourceId = ?").run(num);
  rx.query("UPDATE rx_meta SET state = 0 WHERE rxKey = ?").run(id);
  return r.changes > 0 ? { ok: true } : { ok: false, reason: "该汤方未被删除" };
}

// 撤销对源方剂的修改（回到源库原始值）
// 除了删覆盖层与用户组成，还必须把 rx_meta 同步回源库值：
// 否则列表仍显示改写后的名称 / 功效 / 药味数，与详情页（读源库）不一致。
export async function resetPrescription(id: string): Promise<{ ok: boolean; reason?: string }> {
  const { kind, num } = parseRxId(id);
  if (kind !== "s" || !num) return { ok: false, reason: "仅源库汤方支持还原" };
  const r = rx.query("DELETE FROM rx_overrides WHERE sourceId = ?").run(num);
  rx.query("DELETE FROM rx_herbs WHERE rxKey = ? AND kind = 1").run(id);

  const row = await queryOne<any>(
    `SELECT MingCheng, PYFile, PinYinZT, ZhaiLu, GongNengZZ FROM zysjyj WHERE TypeID = 39 AND ID = ?`,
    [num]
  );
  if (!row) return { ok: false, reason: "汤方不存在" };
  const comp = (
    rx.query("SELECT herbId, name, note, dosage, raw FROM rx_herbs WHERE rxKey = ? AND kind = 0 ORDER BY seq").all(id) as any[]
  ).map(toCompRow);
  const gong = norm(row.GongNengZZ);
  const pinyin = norm(row.PYFile) || norm(row.PinYinZT);
  saveMeta(id, false, {
    MingCheng: norm(row.MingCheng),
    PinYin: pinyin,
    letter: letterOf(pinyin, pinyin),
    effect: detectEffect(gong).effect,
    origin: normalizeOrigin(row.ZhaiLu),
    herbCount: comp.length,
  });
  return { ok: true, reason: r.changes > 0 ? undefined : "该汤方没有修改记录" };
}

// ===== 药材 → 含该药材的汤方（药材详情页联动）=====
// 票数很大的药材（如甘草 1.5 万首）只取前 N 首用于详情页展示，故单独再算一次总数。
export async function herbRelatedRx(
  herbId: number | string,
  limit = 8
): Promise<{ total: number; items: { id: string; title: string; usage: string }[] }> {
  const ids = herbIdGroup(Number(herbId));
  if (ids.length === 0) return { total: 0, items: [] };
  const ph = ids.map(() => "?").join(",");
  const total = Number(
    (
      rx
        .query(
          `SELECT COUNT(DISTINCT h.rxKey) AS c
           FROM rx_herbs h JOIN rx_meta m ON m.rxKey = h.rxKey
           WHERE h.herbId IN (${ph}) AND m.state = 0`
        )
        .get(...ids) as any
    )?.c ?? 0
  );
  const list = await prescriptionsByHerb(herbId, limit);
  return { total, items: list.map((r) => ({ id: r.id, title: r.title, usage: r.usage })) };
}

export async function prescriptionsByHerb(herbId: number | string, limit = 12): Promise<{ id: string; title: string; usage: string; matched: boolean }[]> {
  const hid = Number(herbId);
  if (!hid) return [];
  // 展开同名药材 ID（重名条目）：用户在任意一条记录上都能看到完整的相关汤方
  const ids = herbIdGroup(hid);
  const ph = ids.map(() => "?").join(",");
  const rows = rx
    .query(
      `SELECT h.rxKey, h.name, m.MingCheng, m.custom
       FROM rx_herbs h JOIN rx_meta m ON m.rxKey = h.rxKey
       WHERE h.herbId IN (${ph}) AND m.state = 0
       ORDER BY m.custom DESC, m.MingCheng LIMIT ?`
    )
    .all(...ids, Math.max(1, Math.min(50, limit))) as any[];
  const srcIds: number[] = [];
  const customIds: number[] = [];
  for (const r of rows) {
    if (String(r.rxKey).startsWith("s")) srcIds.push(Number(String(r.rxKey).slice(1)));
    else customIds.push(Number(String(r.rxKey).slice(1)));
  }
  const usageMap = new Map<string, string>();
  if (srcIds.length) {
    const ph = srcIds.map(() => "?").join(",");
    const rs = await queryRows<any>(`SELECT ID, YongFaYL FROM zysjyj WHERE TypeID = 39 AND ID IN (${ph})`, srcIds);
    for (const r of rs) usageMap.set(`s${r.ID}`, excerpt(r.YongFaYL, 40));
  }
  if (customIds.length) {
    const ph = customIds.map(() => "?").join(",");
    for (const r of rx.query(`SELECT id, YongFaYL FROM rx_custom WHERE id IN (${ph})`).all(...customIds) as any[]) {
      usageMap.set(`c${r.id}`, excerpt(r.YongFaYL, 40));
    }
  }
  return rows.map((r) => ({
    id: String(r.rxKey),
    title: r.MingCheng,
    usage: usageMap.get(String(r.rxKey)) ?? "",
    matched: true,
  }));
}

// ===== 首页「汤方」卡片 =====
// 优先展示常见名方，不足 8 首时用经典古籍方剂补齐（按药味数降序，内容更完整）
export function homeRxSection(): {
  key: string;
  name: string;
  icon: string;
  desc: string;
  count: number;
  samples: { id: string; title: string; subtitle: string }[];
} | null {
  try {
    const st = rxStats();
    const names = [
      "麻黄汤", "桂枝汤", "小柴胡汤", "四君子汤", "四物汤", "六味地黄丸",
      "补中益气汤", "逍遥散", "银翘散", "半夏泻心汤", "龙胆泻肝汤", "归脾汤",
    ];
    const ph = names.map(() => "?").join(",");
    const picked = rx
      .query(`SELECT rxKey, MingCheng FROM rx_meta WHERE state = 0 AND MingCheng IN (${ph})`)
      .all(...names) as { rxKey: string; MingCheng: string }[];
    const byName = new Map(picked.map((r) => [r.MingCheng, r]));
    const samples: { id: string; title: string; subtitle: string }[] = [];
    for (const n of names) {
      const hit = byName.get(n);
      if (hit && samples.length < 8) samples.push({ id: hit.rxKey, title: hit.MingCheng, subtitle: "" });
    }
    if (samples.length < 8) {
      const extra = rx
        .query(
          `SELECT rxKey, MingCheng FROM rx_meta
           WHERE state = 0 AND origin = '经典古籍' AND MingCheng NOT IN (${ph})
           ORDER BY herbCount DESC LIMIT ?`
        )
        .all(...names, 8 - samples.length) as { rxKey: string; MingCheng: string }[];
      for (const e of extra) {
        if (samples.length >= 8) break;
        samples.push({ id: e.rxKey, title: e.MingCheng, subtitle: "" });
      }
    }
    if (samples.length === 0) return null;
    return {
      key: "prescriptions",
      name: "汤方",
      icon: "Soup",
      desc: "方剂组成、煎煮服用方法与功效禁忌，可与中药材互查。",
      count: Math.max(0, st.meta - st.metaHidden),
      samples,
    };
  } catch {
    return null;
  }
}

// 索引统计（用于诊断/脚本输出）
export function rxStats() {
  const meta = Number((rx.query("SELECT COUNT(*) AS c FROM rx_meta").get() as any)?.c ?? 0);
  const metaCustom = Number((rx.query("SELECT COUNT(*) AS c FROM rx_meta WHERE custom = 1").get() as any)?.c ?? 0);
  const metaHidden = Number((rx.query("SELECT COUNT(*) AS c FROM rx_meta WHERE state = 1").get() as any)?.c ?? 0);
  const herbs = Number((rx.query("SELECT COUNT(*) AS c FROM rx_herbs").get() as any)?.c ?? 0);
  const matched = Number((rx.query("SELECT COUNT(*) AS c FROM rx_herbs WHERE herbId IS NOT NULL").get() as any)?.c ?? 0);
  const custom = Number((rx.query("SELECT COUNT(*) AS c FROM rx_custom").get() as any)?.c ?? 0);
  const overrides = Number((rx.query("SELECT COUNT(*) AS c FROM rx_overrides").get() as any)?.c ?? 0);
  const deleted = Number((rx.query("SELECT COUNT(*) AS c FROM rx_deleted").get() as any)?.c ?? 0);
  return { meta, metaCustom, metaHidden, herbs, matched, custom, overrides, deleted };
}
