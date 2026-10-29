// ===== 模块配置：把原数据库表映射到站点栏目 =====

export type Kind = "herb" | "book" | "article";

export interface ModuleCfg {
  key: string;
  name: string;
  icon: string; // lucide 图标名
  table: string;
  idCol: string;
  titleCol: string;
  kind: Kind;
  filter?: string; // 原始 SQL WHERE 片段（不含 AND 前缀）
  searchCols: string[];
  subtitleCol?: string;
  subtitleExpr?: string; // 原始 SQL 表达式，用于生成更有意义的列表副标题（优先于 subtitleCol）
  orderBy?: string; // 列表/搜索的排序子句，默认为 "id"
  desc: string;
}

export const MODULES: Record<string, ModuleCfg> = {
  dictionary: {
    key: "dictionary",
    name: "中医术语词典",
    icon: "BookOpen",
    table: "zysjyj",
    idCol: "ID",
    titleCol: "MingCheng",
    kind: "herb",
    searchCols: ["MingCheng", "BieMing", "PinYin", "YingWenMing", "ChuChu", "GongNengZZ", "GuiJing", "XingWei"],
    // 本表实为「中药材(TypeID=40, 18295) + 方剂(TypeID=39, 52050)」混合。
    // 方剂几乎没有「性味」（52050 条中仅 1 条有），若直接用 XingWei 作副标题会大面积空白，
    // 故回退到「功能主治」；标注口径见 data/annotations/entity_categories.json。
    subtitleExpr: `CASE
      WHEN XingWei IS NOT NULL AND TRIM(XingWei) <> '' THEN XingWei
      ELSE GongNengZZ END`,
    desc: "中药材与方剂的名称、性味、归经、功能主治等专业术语查询。",
  },
  works: {
    key: "works",
    name: "中医著作",
    icon: "Library",
    table: "zysjllsj",
    idCol: "ID",
    titleCol: "BiaoTi",
    kind: "book",
    // ④ 著作搜索仅检索标题与正文，剔除无意义的层级编码列 BM1~BM4
    searchCols: ["BiaoTi", "NeiRong"],
    // ① 列表副标题改为层级路径（根据 BM1/BM2/BM3 还原为「第N篇 · 第N章 · 第N节」）
    subtitleExpr: `CASE
      WHEN CAST(BM1 AS INTEGER) > 0 AND CAST(BM2 AS INTEGER) > 0 AND CAST(BM3 AS INTEGER) > 0
        THEN '第' || CAST(BM1 AS INTEGER) || '篇 · 第' || CAST(BM2 AS INTEGER) || '章 · 第' || CAST(BM3 AS INTEGER) || '节'
      WHEN CAST(BM1 AS INTEGER) > 0 AND CAST(BM2 AS INTEGER) > 0
        THEN '第' || CAST(BM1 AS INTEGER) || '篇 · 第' || CAST(BM2 AS INTEGER) || '章'
      WHEN CAST(BM1 AS INTEGER) > 0 AND CAST(BM3 AS INTEGER) > 0
        THEN '第' || CAST(BM1 AS INTEGER) || '篇 · 第' || CAST(BM3 AS INTEGER) || '节'
      WHEN CAST(BM2 AS INTEGER) > 0 AND CAST(BM3 AS INTEGER) > 0
        THEN '第' || CAST(BM2 AS INTEGER) || '章 · 第' || CAST(BM3 AS INTEGER) || '节'
      WHEN CAST(BM1 AS INTEGER) > 0 THEN '第' || CAST(BM1 AS INTEGER) || '篇'
      WHEN CAST(BM2 AS INTEGER) > 0 THEN '第' || CAST(BM2 AS INTEGER) || '章'
      WHEN CAST(BM3 AS INTEGER) > 0 THEN '第' || CAST(BM3 AS INTEGER) || '节'
      ELSE '' END`,
    // ③ 列表/搜索按 书(TypeID) + 篇/章/节 排序，让同书章节连续、浏览有序
    orderBy: "TypeID, BM1, BM2, BM3, id",
    desc: "历代中医古籍与专著的内容检索与在线阅读。",
  },
  yian: {
    key: "yian",
    name: "医案心得",
    icon: "FileText",
    table: "zysjzhsj",
    idCol: "ID",
    titleCol: "BiaoTi",
    kind: "article",
    // 原用标题正则 `医案|验案|诊疗|临床|心得|治验` 划分，经核对源库 TypeID 发现严重偏差：
    // 正则命中 1222 条中约 962 条是科普/资讯误判，而真正的医案（TypeID=7，2035 条）仅命中 260 条，
    // 漏判 87.2%。TypeID 是源库自带的可靠分类，故改用 TypeID 划分。
    filter: "TypeID = 7",
    searchCols: ["BiaoTi", "NeiRong", "KeyWord"],
    subtitleCol: "KeyWord",
    desc: "历代名医医案与临床诊疗心得。",
  },
  zaji: {
    key: "zaji",
    name: "杂集",
    icon: "Layers",
    table: "zysjzhsj",
    idCol: "ID",
    titleCol: "BiaoTi",
    kind: "article",
    // 杂集 = 非医案，并剔除「站点杂项(1031)」「图片集(33,34)」等非医药内容。
    filter: "TypeID != 7 AND TypeID NOT IN (33, 34, 1031)",
    searchCols: ["BiaoTi", "NeiRong", "KeyWord"],
    subtitleCol: "KeyWord",
    desc: "中医相关的杂论、随笔与资料汇编。",
  },
};

export const REAL_MODULE_KEYS = Object.keys(MODULES);

// 中药材详情页字段分组（中文标签）
export const HERB_FIELD_GROUPS: { group: string; fields: { col: string; label: string }[] }[] = [
  {
    group: "基本信息",
    fields: [
      { col: "MingCheng", label: "名称" },
      { col: "PinYin", label: "拼音" },
      { col: "YingWenMing", label: "英文名" },
      { col: "BieMing", label: "别名" },
      { col: "ChuChu", label: "出处" },
      { col: "LaiYuan", label: "来源" },
      { col: "XingZhuang", label: "性状" },
    ],
  },
  {
    group: "药性功效",
    fields: [
      { col: "XingWei", label: "性味" },
      { col: "GuiJing", label: "归经" },
      { col: "GongNengZZ", label: "功能主治" },
      { col: "YongFaYL", label: "用法用量" },
      { col: "ZhuYi", label: "注意" },
      { col: "DuXing", label: "毒性" },
      { col: "PaoZhi", label: "炮制" },
    ],
  },
  {
    group: "现代研究",
    fields: [
      { col: "HuaXueCF", label: "化学成分" },
      { col: "YaoLiZY", label: "药理作用" },
      { col: "GeJiaLS", label: "各家论述" },
      { col: "LinChuangYY", label: "临床运用" },
      { col: "ZhaiLu", label: "摘录" },
      { col: "BeiZhu", label: "备注" },
    ],
  },
];

// ===== 中医理论术语词典（种子数据，准确释义）=====
export interface GlossaryTerm {
  term: string;
  pinyin: string;
  category: string;
  definition: string;
}

export const GLOSSARY: GlossaryTerm[] = [
  { term: "阴阳", pinyin: "yīn yáng", category: "基本原理", definition: "中国古代哲学的一对范畴，用以概括自然界相互关联又相互对立的两种事物或现象的属性。中医学用以说明人体的组织结构、生理功能、病理变化，并指导诊断与治疗。" },
  { term: "五行", pinyin: "wǔ xíng", category: "基本原理", definition: "木、火、土、金、水五种基本物质的运动变化。中医学用以归纳脏腑属性、生理联系及病理传变，即五行学说。" },
  { term: "藏象", pinyin: "zàng xiàng", category: "藏象学说", definition: "藏于体内的脏腑及其表现于外的生理、病理征象。藏象学说研究脏腑的生理功能、病理变化及其相互关系。" },
  { term: "六腑", pinyin: "liù fǔ", category: "藏象学说", definition: "胆、胃、小肠、大肠、膀胱、三焦的总称，以受盛、传化水谷为其主要生理功能，生理特点为“泻而不藏”。" },
  { term: "五脏", pinyin: "wǔ zàng", category: "藏象学说", definition: "心、肝、脾、肺、肾的总称，多为实质性脏器，生理特点为“藏精气而不泻”。" },
  { term: "经络", pinyin: "jīng luò", category: "经络学说", definition: "运行气血、联络脏腑肢节、沟通上下内外的通路。包括十二正经、奇经八脉及络脉、孙脉等。" },
  { term: "气血津液", pinyin: "qì xuè jīn yè", category: "基本原理", definition: "构成人体和维持生命活动的基本物质。气有推动、温煦、防御、固摄等作用；血主濡养；津液润滑滋养。" },
  { term: "辨证论治", pinyin: "biàn zhèng lùn zhì", category: "诊疗原则", definition: "中医认识和治疗疾病的基本原则。辨证是分析、辨认疾病的证候；论治是确定相应的治法。" },
  { term: "八纲辨证", pinyin: "bā gāng biàn zhèng", category: "诊断方法", definition: "运用阴阳、表里、寒热、虚实八类纲领，对四诊所得资料进行综合归纳，以辨别疾病位置、性质与邪正盛衰。" },
  { term: "四诊", pinyin: "sì zhěn", category: "诊断方法", definition: "望、闻、问、切四种诊察疾病的方法，是中医搜集临床资料的基本手段。" },
  { term: "脉象", pinyin: "mài xiàng", category: "诊断方法", definition: "手指感知的脉搏形象，包括脉位、脉次、脉力、脉形、脉势等，用以推断脏腑气血盛衰。" },
  { term: "性味", pinyin: "xìng wèi", category: "中药基础", definition: "药物的性质与味道。性指寒、热、温、凉（四气）；味指辛、甘、酸、苦、咸（五味），是药性理论的核心。" },
  { term: "归经", pinyin: "guī jīng", category: "中药基础", definition: "药物对机体某部分（脏腑、经络）的选择性治疗作用，表明药物作用定位。" },
  { term: "升降浮沉", pinyin: "shēng jiàng fú chén", category: "中药基础", definition: "药物作用于人体的趋向。升浮主上行而向外，沉降主下行而向内，用以纠正病势。" },
  { term: "君臣佐使", pinyin: "jūn chén zuǒ shǐ", category: "方剂理论", definition: "方剂配伍的基本结构。君药针对主病主证，臣药助君增效，佐药制约或兼治，使药调和引经。" },
  { term: "方剂", pinyin: "fāng jì", category: "方剂理论", definition: "在辨证立法的基础上，按组方原则选择药物并确定用量，酌定剂型而成的处方。" },
  { term: "治法", pinyin: "zhì fǎ", category: "诊疗原则", definition: "治疗疾病的具体方法，如汗、吐、下、和、温、清、消、补八法，以及扶正祛邪、调整阴阳等。" },
  { term: "扶正祛邪", pinyin: "fú zhèng qū xié", category: "诊疗原则", definition: "扶助正气、祛除病邪的治疗总则，依邪正盛衰消长而灵活运用。" },
  { term: "治未病", pinyin: "zhì wèi bìng", category: "养生预防", definition: "未病先防、既病防变。强调调摄养生与早期干预，是中医预防医学思想的体现。" },
  { term: "体质", pinyin: "tǐ zhì", category: "养生预防", definition: "个体在先天禀赋与后天调养基础上形成的形态结构、生理功能和心理状态的综合特质。" },
  { term: "津液", pinyin: "jīn yè", category: "基本原理", definition: "机体一切正常水液的总称，包括各脏腑组织的内在体液及其分泌物，起滋润濡养作用。" },
  { term: "营卫", pinyin: "yíng wèi", category: "基本原理", definition: "营气行于脉中，化生血液、营养周身；卫气行于脉外，温养肌肤、捍御外邪。" },
  { term: "六淫", pinyin: "liù yín", category: "病因病机", definition: "风、寒、暑、湿、燥、火六种外感病邪的统称，由正气不足、脏腑失调而侵袭致病。" },
  { term: "七情", pinyin: "qī qíng", category: "病因病机", definition: "喜、怒、忧、思、悲、恐、惊七种情志变化，过极可内伤脏腑、气机失调而致病。" },
  { term: "病机", pinyin: "bìng jī", category: "病因病机", definition: "疾病发生、发展与变化的机理，主要包括邪正盛衰、阴阳失调、气血津液失常等。" },
  { term: "伤寒", pinyin: "shāng hán", category: "病证", definition: "外感风寒之邪引起的外感病，亦为《伤寒论》所论外感热病之总称，以六经辨证为纲。" },
  { term: "温病", pinyin: "wēn bìng", category: "病证", definition: "感受温邪引起的外感热病，以卫气营血与三焦辨证为纲，注重清热保津。" },
  { term: "针灸", pinyin: "zhēn jiǔ", category: "治法", definition: "针法与灸法的总称，通过刺激腧穴以疏通经络、调和气血，是中医重要的外治疗法。" },
  { term: "腧穴", pinyin: "shù xué", category: "针灸", definition: "脏腑经络气血输注于体表的部位，是针灸、推拿等疗法的刺激点，亦称穴位。" },
  { term: "灸法", pinyin: "jiǔ fǎ", category: "针灸", definition: "用艾绒等物燃烧温熨体表穴位，借温热刺激以温通经脉、扶阳祛寒的外治疗法。" },
];

// ===== 中医教材资料（种子数据）=====
export interface Textbook {
  id: string;
  title: string;
  category: string;
  desc: string;
  related?: { module: string; query: string };
}

export const TEXTBOOKS: Textbook[] = [
  { id: "tcm-base", title: "中医基础理论", category: "基础类", desc: "系统阐述阴阳五行、藏象、气血津液、经络、病因病机与养生防治，是中医学的入门根基。", related: { module: "works", query: "中医基础理论" } },
  { id: "tcm-diag", title: "中医诊断学", category: "基础类", desc: "讲授望闻问切四诊与八纲、脏腑、气血津液等辨证方法，训练临床辨证思维。", related: { module: "works", query: "中医诊断" } },
  { id: "tcm-herb", title: "中药学", category: "基础类", desc: "介绍常用中药的性味归经、功效主治、用法用量及配伍禁忌，构建用药基础。", related: { module: "dictionary", query: "中药" } },
  { id: "tcm-formula", title: "方剂学", category: "基础类", desc: "研究方剂的组方原则、配伍规律与临床运用，贯通辨证与用药。", related: { module: "dictionary", query: "汤" } },
  { id: "tcm-internal", title: "中医内科学", category: "临床类", desc: "以脏腑辨证为主线，系统阐述内科常见病的病因、病机、辨证与治疗。", related: { module: "yian", query: "内科" } },
  { id: "tcm-acu", title: "针灸学", category: "临床类", desc: "涵盖经络腧穴、刺灸方法与临床治疗，是中医外治的核心教材。", related: { module: "works", query: "针灸" } },
  { id: "tcm-gyn", title: "中医妇科学", category: "临床类", desc: "研究经、带、胎、产及妇科杂病的辨证论治规律。", related: { module: "works", query: "妇科" } },
  { id: "tcm-peds", title: "中医儿科学", category: "临床类", desc: "阐述小儿生理病理特点及常见病证的辨证施治。", related: { module: "works", query: "儿科" } },
  { id: "tcm-classic", title: "中医经典研读", category: "经典类", desc: "《黄帝内经》《伤寒论》《金匮要略》《温病条辨》等经典的研读与临证发挥。", related: { module: "works", query: "黄帝内经" } },
  { id: "tcm-history", title: "中国医学史", category: "人文类", desc: "梳理中医学术源流、流派演变与历代名医名著，深化文化认知。", related: { module: "works", query: "医学史" } },
];

// ===== 备考资源（种子数据）=====
export interface ExamResource {
  id: string;
  title: string;
  desc: string;
  scope: string[];
}

export const EXAM_RESOURCES: ExamResource[] = [
  { id: "physician", title: "中医执业医师资格考试", desc: "国家统一考试，考查中医基础、临床与法规。含实践技能与综合笔试两阶段。", scope: ["中医基础理论", "中医诊断学", "中药学", "方剂学", "中医内科学", "针灸学", "卫生法规"] },
  { id: "integrated-tcm", title: "考研中医综合", desc: "中医学硕/专硕入学考试，覆盖中基、中诊、中药、方剂、中内、针灸六大板块。", scope: ["中医基础理论", "中医诊断学", "中药学", "方剂学", "中医内科学", "针灸学"] },
  { id: "combined", title: "中西医结合执业医师", desc: "在中西医两套体系下考查临床综合能力，侧重辨病辨证结合。", scope: ["中医", "西医基础", "中西医结合临床"] },
  { id: "apprentice", title: "中医师承与确有专长考核", desc: "面向师承及确有专长人员的出师/考核，重实战经验与经典功底。", scope: ["师承临床", "经典背诵", "专长技术"] },
  { id: "post", title: "中医规培与职称晋升", desc: "住院医师规范化培训及中、高级职称考试，强调临床胜任力。", scope: ["临床轮训", "病例分析", "科研方法"] },
];

// ===== 使用手册（静态内容）=====
export const MANUAL_SECTIONS = [
  { title: "站点简介", body: "本平台是一个面向中医学习、临床与备考的综合性查询工具，数据源自公开的中医古籍、药材、方剂与医案资料库。提供术语词典、著作检索、教材浏览、备考整理与使用手册五大模块。" },
  { title: "快速检索", body: "在顶部搜索框输入关键词（药名、书名、病症、术语均可），回车后将在全部资源中检索，并按模块分组展示结果。也可进入各模块后使用模块内筛选与分页。" },
  { title: "中医术语词典", body: "包含“药物术语”（中药材/方剂，来自药材库）与“理论术语”（阴阳、五行、辨证等核心概念释义）两个子库，支持按拼音或类别筛选。" },
  { title: "中医著作", body: "可检索历代中医古籍与专著，点击进入阅读正文。正文保留原书的段落与重点标注格式。" },
  { title: "教材与备考", body: "教材栏目按基础、临床、经典、人文分类梳理学习资料；备考栏目汇总执业医师、考研中医综合等常见考试的考查范围，便于制定复习计划。" },
  { title: "数据说明", body: "药材、方剂、著作、医案等正文内容来自原始数据库备份，释义类内容为辅助整理。本平台仅供学习研究，临床用药请遵医嘱。" },
  { title: "隐私与安全", body: "本站为本地演示部署，不收集个人敏感信息；检索仅在本地数据库进行。正式部署建议启用访问鉴权与 HTTPS。" },
];
