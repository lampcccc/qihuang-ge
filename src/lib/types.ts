export type Kind = "herb" | "book" | "article";

export interface ModuleInfo {
  key: string;
  name: string;
  icon: string;
  desc: string;
  kind: Kind;
}

export interface ListItem {
  id: string | number;
  title: string;
  subtitle?: string;
}

export interface ListResult {
  key: string;
  name: string;
  icon: string;
  kind: Kind;
  total: number;
  page: number;
  pageSize: number;
  items: ListItem[];
}

export interface HerbField {
  label: string;
  value: string;
}

export interface HerbGroup {
  group: string;
  fields: HerbField[];
}

export interface ResourceNavItem {
  id: string | number;
  title: string;
}

// 药材「相关方剂」条目（由 FuFang 字段解析：主治 → 方名 + 组成用法）
export interface HerbFormula {
  title: string;   // 主治/适应症
  formula?: string; // 方名（括号内以 方/汤/散/丸/饮/丹/膏 结尾者），可能缺失
  body: string;     // 组成与用法
}

// 药材来源产地（整页详情「来源产地」模块）
export interface HerbOrigin {
  source: string;     // 来源（基原：科属 + 药用部位）
  habitat: string;    // 生境分布 / 产地
  morphology: string; // 原植物形态
  storage: string;    // 贮藏
}

export interface ResourceResult {
  key: string;
  kind: Kind;
  title: string;
  meta: Record<string, string>;
  prose: string;
  keyword?: string;
  groups?: HerbGroup[];
  annotation?: HerbAnnotation;
  nav?: { prev: ResourceNavItem | null; next: ResourceNavItem | null };
  bookId?: number; // 著作类章节所属书名（TypeID），用于返回该书目录
  bookTitle?: string; // 著作类章节所属书名（展示用）
  images?: string[]; // 药材图片文件名（源库仅约 1.9% 有记录，缺失时前端占位）
  related?: HerbFormula[]; // 相关方剂（由 FuFang 文本解析的方剂条目）
  origin?: HerbOrigin; // 来源产地
  rx?: HerbRelatedRx; // 关联汤方（由汤方索引反查，结构化汤方条目）
}

export interface SearchGroup extends ListResult {}

export interface SearchResult {
  q: string;
  total: number;
  page: number;
  pageSize: number;
  results: SearchGroup[];
}

// ===== 汤方（自建 + 源库 TypeID=39 方剂）=====
// 沿用中药材的字段命名风格（MingCheng / PinYin / GongNengZZ / YongFaYL / ZhuYi / BeiZhu / PaoZhi / ZhaiLu / ChuFang）
export interface RxComposition {
  herbId: number | null; // 关联到的药材 ID（未匹配为 null）
  name: string;          // 药材名（已剥离炮制修饰）
  note: string;          // 炮制/特殊标注（如 去节、炒、炙）
  dosage: string;        // 用量（如 6g、三钱）
  raw: string;           // 组成原文片段
  matched: boolean;      // 是否关联到药材库
}

export interface RxListItem {
  id: string;          // s123（源库）/ c45（自建）
  custom: boolean;
  title: string;
  pinyin: string;
  subtitle: string;    // 组成摘要
  gongneng: string;    // 功效与适应症
  origin: string;      // 出处（已归类）
  effect: string;      // 功效分类（复用中药材口径）
  herbCount: number;
}

export interface RxFacetItem {
  value: string;
  count: number;
}

export interface PrescriptionsResult {
  total: number;
  page: number;
  pageSize: number;
  items: RxListItem[];
  facets: {
    letters: { letter: string; count: number }[];
    origins: RxFacetItem[];
    effects: RxFacetItem[];
  };
}

export interface PrescriptionDetail {
  id: string;
  custom: boolean;
  title: string;
  pinyin: string;
  alias: string;
  origin: string;
  effect: string;
  effectConfidence: string;
  // 五个核心模块（对应需求：组成药材 / 煎煮服用 / 功效适应症 / 禁忌 / 备注）
  composition: RxComposition[];
  usage: string;
  gongneng: string;
  taboo: string;
  remark: string;
  prep: string;
  groups: HerbGroup[];
  editable: boolean;      // 源库方剂与自建方剂都可编辑（源库为覆盖层，不改动源数据）
  isOverridden: boolean;  // 是否已存在针对源库方剂的修改
  updatedAt: number | null;
}

// 药材名联想条目（汤方组成录入时按药名 / 别名匹配，正名优先）
export interface HerbSuggestion {
  id: number;
  title: string;
  pinyin: string;
}

// 药材详情「关联汤方」（由汤方索引反查组成中含该药材的汤方）
export interface HerbRelatedRx {
  total: number;
  items: { id: string; title: string; usage: string }[];
}

// 新建 / 编辑汤方的提交体（与后端 RxInput 一致，字段名沿用源库命名）
export interface RxInput {
  MingCheng: string;
  PinYin?: string;
  BieMing?: string;
  ZhaiLu?: string;
  ChuFang?: string;
  YongFaYL?: string;
  GongNengZZ?: string;
  ZhuYi?: string;
  BeiZhu?: string;
  PaoZhi?: string;
  composition?: { name: string; note?: string; dosage?: string; herbId?: number | null }[];
}

// ===== 中医著作（按书名聚合）=====
export interface BookListItem {
  typeId: number;
  title: string;
  author: string | null;
  era: string | null;
  method: string; // override/bookmark/jianjie/chapter/classic/author/topic/category
  chapterCount: number;
  firstChapter: string;
}

export interface BookListResult {
  key: string;
  name: string;
  icon: string;
  kind: Kind;
  total: number;
  page: number;
  pageSize: number;
  items: BookListItem[];
}

export interface BookChapter {
  id: number;
  title: string;
  path: string;
}

export interface BookTocResult {
  typeId: number;
  title: string;
  author: string | null;
  era: string | null;
  method: string;
  total: number;
  chapters: BookChapter[];
}

export interface HomeSection {
  key: string;
  name: string;
  icon: string;
  desc: string;
  count: number;
  samples: ListItem[];
}

export interface HomeResult {
  sections: HomeSection[];
  glossaryCount: number;
  textbookCount: number;
  examCount: number;
}

export interface GlossaryTerm {
  term: string;
  pinyin: string;
  category: string;
  definition: string;
}

export interface Textbook {
  id: string;
  title: string;
  category: string;
  desc: string;
  related?: { module: string; query: string };
}

export interface ExamResource {
  id: string;
  title: string;
  desc: string;
  scope: string[];
}

export interface ManualSection {
  title: string;
  body: string;
}

export interface HerbItem {
  id: string | number;
  title: string;
  subtitle: string;
  pinyin: string;
  meridian: string;
  gongneng: string;
}

export interface HerbFacetItem {
  letter?: string;
  value?: string;
  count: number;
}

export interface HerbsResult {
  total: number;
  page: number;
  pageSize: number;
  items: HerbItem[];
  facets: {
    letters: HerbFacetItem[];
    natures: HerbFacetItem[];
    flavors: HerbFacetItem[];
    effects: HerbFacetItem[];
    meridians: HerbFacetItem[];
  };
}

// 药材结构化标注（由离线脚本 annotate.ts 生成）
export interface HerbAnnotation {
  name: string;
  nature: string;
  flavors: string[];
  meridians: string[];
  toxicity: string;
  effect: string;
  effectConfidence: string;
  completeness: number;
}

// 四性 × 五味 交叉统计（聚合视图）
export interface NatureFlavorMatrix {
  natures: string[]; // 行（四气：温/热/寒/凉/平，必要时含“其他”）
  flavors: string[]; // 列（五味：辛/甘/酸/苦/咸，必要时含“其他”）
  cells: Record<string, number>; // key 为 `${四气}|${五味}`
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  total: number;
}
