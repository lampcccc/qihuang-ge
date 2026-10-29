// 《中药学》功效分类（21 类）的共享实现。
// 原先仅存在于 annotate.ts，汤方模块需要用同一套规则给方剂分类（保证筛选口径一致），
// 故抽为独立模块；annotate.ts 改为从这里引用，避免两份词典漂移。
export const has = (s: string, kw: string) => s.includes(kw);

export interface EffectRule {
  name: string;
  kws: string[];
  weak: string[];
}

// 关键设计：源库 GongNengZZ 把「功效」与「主治」混写（如“渗湿利水；健脾和胃；宁心安神。主…心悸…失眠…”）。
// 若不加区分，主治里的常见症状（心悸/失眠/止痛）会盖过真正的功效。故先切分两段并加权：
//   功效段（“主/用于/适用/治”之前）权重高，主治段权重低。
// 同时区分「定义性关键词」(kws，权重高) 与「伴随症状词」(weak，权重低)。
export const EFFECT_RULES: EffectRule[] = [
  // 注：「解肌清热」是固定清热术语（如石膏），故解表药只保留「解肌发表」这一解表用法，
  // 避免「解肌」把石膏这类清热药误判为解表药。
  { name: "解表药", kws: ["发汗解表", "解表", "解肌发表", "透疹", "疏风", "散寒解表", "宣肺"], weak: ["感冒", "鼻塞", "表证", "恶寒发热"] },
  { name: "清热药", kws: ["清热", "解肌清热", "泻火", "清肝", "清心", "清肺", "清胃", "凉血", "清热解毒"], weak: ["退热", "消炎", "高热", "热病", "烦躁"] },
  { name: "泻下药", kws: ["泻下", "泻实热", "泻热", "攻下", "荡涤", "润肠", "峻下", "逐水", "通便"], weak: ["便秘", "大便秘结"] },
  { name: "祛风湿药", kws: ["祛风湿", "通络", "舒筋", "活络", "强筋骨"], weak: ["风湿", "痹痛", "关节", "腰膝"] },
  { name: "化湿药", kws: ["化湿", "芳香化湿", "醒脾"], weak: ["暑湿", "湿阻", "痞满"] },
  { name: "利水渗湿药", kws: ["利水", "渗湿", "利尿", "通淋"], weak: ["水肿", "小便不利", "黄疸"] },
  { name: "温里药", kws: ["温里", "温中", "回阳", "补火助阳"], weak: ["腹痛", "四肢厥冷", "畏寒"] },
  { name: "理气药", kws: ["理气", "行气", "疏肝", "降气", "消痞"], weak: ["胀满", "气滞", "呕吐", "嗳气"] },
  { name: "消食药", kws: ["消食", "化积", "开胃"], weak: ["食积", "食欲不振"] },
  { name: "驱虫药", kws: ["驱虫", "杀虫"], weak: ["蛔虫", "绦虫", "虫积"] },
  { name: "止血药", kws: ["止血", "凉血止血", "收敛止血"], weak: ["崩漏", "吐血", "便血", "衄血", "尿血", "出血"] },
  { name: "活血化瘀药", kws: ["活血", "化瘀", "破血", "通经"], weak: ["痛经", "经闭", "跌打", "瘀血", "症瘕", "止痛"] },
  { name: "化痰止咳平喘药", kws: ["化痰", "止咳", "平喘", "祛痰", "润肺"], weak: ["咳嗽", "气喘", "痰多"] },
  { name: "安神药", kws: ["安神", "宁心", "镇惊"], weak: ["失眠", "心悸", "惊悸", "健忘"] },
  { name: "平肝息风药", kws: ["平肝", "息风", "止痉"], weak: ["眩晕", "抽搐", "惊风", "头痛"] },
  { name: "开窍药", kws: ["开窍", "醒神"], weak: ["神昏", "昏迷"] },
  { name: "补虚药", kws: ["补气", "补血", "补阴", "补阳", "大补", "补虚", "益精", "益气", "养血", "滋阴", "温阳", "健脾", "补肾", "补中", "补脾", "益肺", "生津"], weak: ["虚弱", "乏力", "虚劳", "气血不足"] },
  { name: "收涩药", kws: ["收涩", "固精", "涩精", "敛汗", "止泻"], weak: ["遗精", "久泻", "自汗", "盗汗"] },
  { name: "涌吐药", kws: ["涌吐", "催吐"], weak: [] },
  { name: "解毒杀虫燥湿止痒药", kws: ["解毒杀虫", "燥湿止痒", "杀虫止痒"], weak: ["止痒", "疮疡", "湿疹", "疥癣", "痈疽"] },
];

export const EFFECT_NAMES = EFFECT_RULES.map((r) => r.name);

// 切分「功效段 / 主治段」：以 主|用于|适用|治 的首个出现位置为界
export function splitGongZhu(gn: string): { gong: string; zhu: string } {
  const m = gn.match(/^([\s\S]*?)(主|用于|适用|治)/);
  if (!m) return { gong: gn, zhu: "" };
  return { gong: m[1] ?? "", zhu: gn.slice(m[1]?.length ?? 0) };
}

export interface EffectResult {
  effect: string;
  score: number;
  confidence: string;
}

export function detectEffect(gn: string): EffectResult {
  if (!gn) return { effect: "其他", score: 0, confidence: "none" };
  const { gong, zhu } = splitGongZhu(gn);

  // 「首要功效」加成：中药学文本习惯把主功效写在最前（如当归“补血；活血…”、半夏“燥湿化痰…”），
  // 仅按总词频取大易被并列项挤掉，故对功效段中最早出现的定义性关键词所属类别给予显著加成。
  const firstIdx = EFFECT_RULES.map((rule) => {
    let min = Number.POSITIVE_INFINITY;
    for (const k of rule.kws) {
      const i = gong.indexOf(k);
      if (i >= 0 && i < min) min = i;
    }
    return min;
  });
  const globalMin = Math.min(...firstIdx);

  let best = "其他";
  let bestScore = 0;
  for (let i = 0; i < EFFECT_RULES.length; i++) {
    const rule = EFFECT_RULES[i]!;
    let s = 0;
    for (const k of rule.kws) {
      if (has(gong, k)) s += 6;      // 功效段 + 定义性词：最强信号
      else if (has(zhu, k)) s += 2;  // 主治段 + 定义性词
    }
    for (const k of rule.weak) {
      if (has(gong, k)) s += 3;      // 功效段 + 症状词
      else if (has(zhu, k)) s += 1;  // 主治段 + 症状词：最弱信号
    }
    if (Number.isFinite(globalMin) && firstIdx[i] === globalMin) s += 15; // 首要功效加成
    if (s > bestScore) { bestScore = s; best = rule.name; }
  }
  const confidence = bestScore >= 15 ? "high" : bestScore >= 6 ? "medium" : bestScore >= 2 ? "low" : "none";
  return { effect: best, score: bestScore, confidence };
}
