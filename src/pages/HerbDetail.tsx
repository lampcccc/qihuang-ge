import { useState, useEffect, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Bookmark,
  BookmarkCheck,
  Share2,
  Check,
  Loader2,
  Leaf,
  FlaskConical,
  Compass,
  MapPin,
  AlertTriangle,
  Pill,
  Tag,
  ScrollText,
  Microscope,
  Soup,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsync } from "@/lib/useAsync";
import { api } from "@/lib/api";
import type { ResourceResult } from "@/lib/types";

const NATURE_LIST = ["温", "热", "寒", "凉", "平"];
const FLAVOR_LIST = ["辛", "甘", "酸", "苦", "咸"];
const FAV_KEY = "tcm:favorite-herbs";

// ===== 收藏：本地持久化（原抽屉无此交互，整页化后按整页需要在顶部补上）=====
function useFavorite(id: string) {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch {
      return [];
    }
  });
  const favored = ids.includes(id);
  const toggle = () => {
    setIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  return { favored, toggle };
}

// ===== 分享：优先系统分享，回退复制到剪贴板 =====
function useShare() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  const share = async (title: string) => {
    const url = window.location.href;
    const text = `${title} · 中药材详情`;
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      try {
        await (navigator as any).share({ title: text, text, url });
        return;
      } catch {
        /* 用户取消或环境不支持，继续走剪贴板兜底 */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* 剪贴板不可用（多为非安全上下文），静默失败 */
    }
  };
  return { copied, share };
}

// 与后端一致的轻量富文本还原（[b] 加粗、换行）
function formatRich(s: string): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[b\]([\s\S]*?)\[\/b\]/g, "<b>$1</b>")
    .replace(/\r?\n/g, "<br/>");
}

export function HerbDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: detail, loading } = useAsync<ResourceResult | null>(
    () => (id ? api.herb(String(id)) : Promise.resolve(null)),
    [id]
  );
  const { favored, toggle: toggleFav } = useFavorite(String(id ?? ""));
  const { copied, share } = useShare();

  const g = (group: string, label: string) =>
    detail?.groups?.find((x) => x.group === group)?.fields.find((f) => f.label === label)?.value || "";

  const nature = g("药性功效", "性味");
  const meridian = g("药性功效", "归经");
  const gongneng = g("药性功效", "功能主治");
  const yongfa = g("药性功效", "用法用量");
  const zhuyi = g("药性功效", "注意");
  const duxing = g("药性功效", "毒性");
  const paozhi = g("药性功效", "炮制");

  const natureVal = useMemo(() => NATURE_LIST.find((n) => nature.includes(n)) || "", [nature]);
  const flavorVals = useMemo(() => FLAVOR_LIST.filter((f) => nature.includes(f)), [nature]);
  const meridianList = useMemo(
    () => (meridian ? meridian.split(/[、,，\s]+/).filter(Boolean) : []),
    [meridian]
  );

  // 标签：出处 + 功效分类 + 性味 + 归经 + 毒性
  const tags = useMemo(() => {
    const out: string[] = [];
    const anno = detail?.annotation;
    if (anno?.effect && anno.effect !== "其他") out.push(anno.effect);
    if (natureVal) out.push(`${natureVal}性`);
    flavorVals.forEach((f) => out.push(`${f}味`));
    (anno?.meridians ?? meridianList).slice(0, 5).forEach((m) => out.push(`${m}经`));
    if (anno?.toxicity && anno.toxicity !== "无毒" && anno.toxicity !== "未标注") out.push(anno.toxicity);
    if (detail?.meta?.出处) out.push(`出自${detail.meta.出处}`);
    return Array.from(new Set(out.filter(Boolean)));
  }, [detail, natureVal, flavorVals, meridianList]);

  if (loading) return <HerbDetailSkeleton />;

  if (!detail) {
    return (
      <div className="animate-fade-in">
        <BackBar onBack={() => navigate("/herbs")} title="未找到该药材" />
        <div className="rounded-xl border border-border bg-card p-10 text-center text-muted-foreground">
          未找到该药材详情，可能已被移除或链接有误。
          <div className="mt-4">
            <Button asChild variant="outline">
              <Link to="/herbs">返回中药材列表</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const origin = detail.origin;
  const anno = detail.annotation;

  // 回列表并带上筛选条件（列表页从 URL 读取筛选，故可直接跳转）
  const browse = (key: "nature" | "flavor" | "effect" | "meridian", value: string) =>
    navigate(`/herbs?${key}=${encodeURIComponent(value)}`);

  return (
    <div className="animate-fade-in">
      <BackBar onBack={() => navigate("/herbs")} title={detail.title} />

      {/* ===== 头部：图片 + 名称信息 ===== */}
      <div className="grid gap-5 rounded-2xl border border-border bg-card p-4 sm:p-6 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <HerbGallery name={detail.title} images={detail.images ?? []} />

        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-serif text-3xl font-bold leading-tight text-tcm-ink sm:text-4xl">
                {detail.title}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {detail.meta.拼音 && <span className="text-tcm-jade">{detail.meta.拼音}</span>}
                {detail.meta.英文名 && <span className="italic">{detail.meta.英文名}</span>}
              </div>
            </div>

            {/* 收藏 / 分享 */}
            <div className="flex shrink-0 gap-2">
              <Button
                variant={favored ? "default" : "outline"}
                size="sm"
                onClick={toggleFav}
                className={favored ? "bg-tcm-gold hover:bg-tcm-gold/90" : ""}
                aria-pressed={favored}
              >
                {favored ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                {favored ? "已收藏" : "收藏"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => share(detail.title)}>
                {copied ? <Check className="h-4 w-4 text-tcm-jade" /> : <Share2 className="h-4 w-4" />}
                {copied ? "已复制链接" : "分享"}
              </Button>
            </div>
          </div>

          {detail.meta.别名 && (
            <div className="mt-3 flex flex-wrap items-start gap-2 text-sm">
              <span className="mt-0.5 shrink-0 text-muted-foreground">别名</span>
              <div className="flex flex-wrap gap-1.5">
                {detail.meta.别名.split(/[、,，;；]/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 12)
                  .map((a) => (
                    <Badge key={a} variant="outline">
                      {a}
                    </Badge>
                  ))}
              </div>
            </div>
          )}

          {/* 速览：性味 / 归经 / 功效 / 毒性 */}
          <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-tcm-jade/20 bg-tcm-jade/[0.06] p-4 sm:grid-cols-4">
            <Stat label="性味" value={nature || "未详"} tone="jade" />
            <Stat label="归经" value={meridian || "未详"} tone="gold" />
            <Stat label="功效分类" value={anno?.effect || "未分类"} tone="gold" />
            <Stat
              label="毒性"
              value={anno?.toxicity || duxing || "未标注"}
              tone={anno?.toxicity && anno.toxicity !== "无毒" ? "cinnabar" : "default"}
            />
          </div>

          {tags.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Tag className="h-3.5 w-3.5 text-muted-foreground" />
              {tags.map((t) => (
                <Badge key={t} variant="jade">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ===== 主体：主内容 + 侧栏 ===== */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* 主内容区 */}
        <div className="space-y-5 lg:col-span-2">
          {(origin?.source || origin?.habitat || origin?.morphology) && (
            <Section icon={<MapPin className="h-4 w-4" />} title="来源产地">
              <dl className="space-y-3">
                {origin?.source && <Row label="来源" value={origin.source} />}
                {origin?.habitat && <Row label="生境分布" value={origin.habitat} />}
                {origin?.morphology && <Row label="原形态" value={origin.morphology} />}
                {origin?.storage && <Row label="贮藏" value={origin.storage} />}
              </dl>
            </Section>
          )}

          <Section icon={<FlaskConical className="h-4 w-4" />} title="性味归经">
            <dl className="space-y-3">
              {nature && <Row label="性味" value={nature} />}
              {meridian && <Row label="归经" value={meridian} />}
            </dl>
            {meridianList.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {meridianList.map((m) => (
                  <button
                    key={m}
                    onClick={() => browse("meridian", m)}
                    className="rounded-full border border-tcm-gold/40 bg-tcm-gold/5 px-3 py-1 text-xs text-tcm-gold transition-colors hover:bg-tcm-gold/10"
                  >
                    {m}经药材
                  </button>
                ))}
              </div>
            )}
          </Section>

          {gongneng && (
            <Section icon={<Leaf className="h-4 w-4" />} title="功效主治">
              <Prose value={gongneng} />
            </Section>
          )}

          {yongfa && (
            <Section icon={<Pill className="h-4 w-4" />} title="用法用量">
              <Prose value={yongfa} />
            </Section>
          )}

          {(zhuyi || duxing || paozhi) && (
            <Section icon={<AlertTriangle className="h-4 w-4" />} title="禁忌配伍">
              <dl className="space-y-3">
                {zhuyi && <Row label="禁忌注意" value={zhuyi} />}
                {duxing && <Row label="毒性" value={duxing} />}
                {paozhi && <Row label="炮制" value={paozhi} />}
              </dl>
            </Section>
          )}

          {detail.related && detail.related.length > 0 && (
            <Section icon={<ScrollText className="h-4 w-4" />} title="相关方剂">
              <div className="space-y-3">
                {detail.related.map((f, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card/50 p-4">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-serif text-base font-semibold text-tcm-ink">{f.title}</span>
                      {f.formula && <Badge variant="gold">{f.formula}</Badge>}
                    </div>
                    <Prose className="mt-1.5" value={f.body} />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 结构化关联汤方：由汤方索引反查「组成中含本药材」的汤方，可直接点进汤方详情 */}
          {detail.rx && detail.rx.total > 0 && (
            <Section icon={<Soup className="h-4 w-4" />} title={`含本药材的汤方（${detail.rx.total} 首）`}>
              <div className="grid gap-2 sm:grid-cols-2">
                {detail.rx.items.map((r) => (
                  <Link
                    key={r.id}
                    to={`/prescriptions/${r.id}`}
                    className="group rounded-xl border border-border bg-card/50 p-3 transition-colors hover:border-tcm-jade/50"
                  >
                    <div className="truncate font-medium text-tcm-ink group-hover:text-tcm-jade">{r.title}</div>
                    {r.usage && (
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{r.usage}</div>
                    )}
                  </Link>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link to={`/prescriptions?herb=${encodeURIComponent(String(id))}&herbName=${encodeURIComponent(detail.title)}`}>
                    查看全部 {detail.rx.total} 首
                  </Link>
                </Button>
                <span className="text-xs text-muted-foreground">
                  组成中含「{detail.title}」的汤方，点击可查看完整组成与用法
                </span>
              </div>
            </Section>
          )}

          {detail.groups?.find((x) => x.group === "现代研究") && (
            <Section icon={<Microscope className="h-4 w-4" />} title="现代研究">
              <dl className="space-y-3">
                {detail.groups
                  .find((x) => x.group === "现代研究")!
                  .fields.map((f) => (
                    <Row key={f.label} label={f.label} value={f.value} />
                  ))}
              </dl>
            </Section>
          )}

          {detail.prose && (
            <Section icon={<ScrollText className="h-4 w-4" />} title="详情阅读">
              <div
                className="space-y-3 text-sm leading-relaxed text-foreground/90 [&_b]:font-semibold [&_b]:text-tcm-ink"
                dangerouslySetInnerHTML={{ __html: detail.prose }}
              />
            </Section>
          )}
        </div>

        {/* 侧栏 */}
        <div className="space-y-5">
          {anno && (
            <div className="rounded-xl border border-tcm-gold/25 bg-tcm-gold/[0.05] p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground/80">数据标注</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  置信度{" "}
                  {anno.effectConfidence === "high"
                    ? "高"
                    : anno.effectConfidence === "medium"
                      ? "中"
                      : anno.effectConfidence === "low"
                        ? "低"
                        : "无数据"}
                </span>
              </div>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">功效分类</dt>
                  <dd className="font-medium text-tcm-gold">{anno.effect}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">毒性</dt>
                  <dd className="font-medium">{anno.toxicity}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">完整度</dt>
                  <dd className="font-medium">{Math.round(anno.completeness * 100)}%</dd>
                </div>
              </dl>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                功效分类由「功能主治」文本按规则抽取（抽样核验约 94%），仅供参考。
              </p>
            </div>
          )}

          {/* 同类药材：跳回列表并按条件筛选 */}
          {(natureVal || flavorVals.length > 0 || anno?.effect) && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground/80">浏览同类药材</h3>
              <div className="flex flex-wrap gap-2">
                {natureVal && (
                  <button
                    onClick={() => browse("nature", natureVal)}
                    className="rounded-full border border-tcm-jade/40 bg-tcm-jade/5 px-3 py-1 text-xs text-tcm-jade transition-colors hover:bg-tcm-jade/10"
                  >
                    {natureVal}性药材
                  </button>
                )}
                {flavorVals.map((f) => (
                  <button
                    key={f}
                    onClick={() => browse("flavor", f)}
                    className="rounded-full border border-tcm-cinnabar/40 bg-tcm-cinnabar/5 px-3 py-1 text-xs text-tcm-cinnabar transition-colors hover:bg-tcm-cinnabar/10"
                  >
                    {f}味药材
                  </button>
                ))}
                {anno?.effect && anno.effect !== "其他" && (
                  <button
                    onClick={() => browse("effect", anno.effect)}
                    className="rounded-full border border-tcm-gold/40 bg-tcm-gold/5 px-3 py-1 text-xs text-tcm-gold transition-colors hover:bg-tcm-gold/10"
                  >
                    {anno.effect}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 其余信息（基本信息组中未在前述模块展示的字段） */}
          {detail.groups?.find((x) => x.group === "基本信息") &&
            detail.groups
              .find((x) => x.group === "基本信息")!
              .fields.filter((f) => !["名称", "拼音", "英文名", "别名", "出处"].includes(f.label)).length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground/80">其他信息</h3>
                <dl className="space-y-2">
                  {detail.groups
                    .find((x) => x.group === "基本信息")!
                    .fields.filter((f) => !["名称", "拼音", "英文名", "别名", "出处"].includes(f.label))
                    .map((f) => (
                      <Row key={f.label} label={f.label} value={f.value} />
                    ))}
                </dl>
              </div>
            )}

          <p className="rounded-xl border border-border bg-card/50 p-4 text-xs leading-relaxed text-muted-foreground">
            内容整理自中药材数据库，仅供学习研究；临床用药请遵医嘱。
          </p>
        </div>
      </div>
    </div>
  );
}

// ===== 面包屑 + 返回列表 =====
function BackBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="mb-4">
      <nav className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-label="面包屑">
        <Link to="/" className="transition-colors hover:text-tcm-jade">
          首页
        </Link>
        <span>/</span>
        <Link to="/herbs" className="transition-colors hover:text-tcm-jade">
          中药材
        </Link>
        <span>/</span>
        <span className="truncate text-foreground/80">{title}</span>
      </nav>
      <Button variant="ghost" size="sm" onClick={onBack} className="mt-2 -ml-2 text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> 返回药材列表
      </Button>
    </div>
  );
}

// ===== 图片轮播：无图时由后端返回占位 SVG =====
function HerbGallery({ name, images }: { name: string; images: string[] }) {
  const [idx, setIdx] = useState(0);
  const hasImages = images.length > 0;
  // 无图片记录时也渲染一帧占位图，保证版式统一（后端 /api/herb-img 会返回占位 SVG）
  const list = hasImages ? images : ["placeholder.jpg"];
  const current = Math.min(idx, list.length - 1);
  const src = (f: string) => `/api/herb-img/${encodeURIComponent(f)}`;

  return (
    <div className="w-full">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border bg-gradient-to-br from-tcm-jade/[0.07] to-tcm-gold/[0.07]">
        <img
          src={src(list[current])}
          alt={`${name} 药材图 ${current + 1}`}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(e) => {
            // 兜底：实体图片缺失时退回占位图，避免出现破图
            const el = e.currentTarget;
            if (!el.src.includes("placeholder")) el.src = "/api/herb-img/placeholder.jpg";
          }}
        />
        {hasImages && list.length > 1 && (
          <>
            <button
              onClick={() => setIdx((i) => (i - 1 + list.length) % list.length)}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/35 p-1.5 text-white transition-colors hover:bg-black/55"
              aria-label="上一张"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setIdx((i) => (i + 1) % list.length)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/35 p-1.5 text-white transition-colors hover:bg-black/55"
              aria-label="下一张"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="absolute bottom-2 right-2 rounded-full bg-black/45 px-2 py-0.5 text-[11px] text-white">
              {current + 1} / {list.length}
            </span>
          </>
        )}
        {!hasImages && (
          <span className="absolute bottom-2 right-2 rounded-full bg-black/35 px-2 py-0.5 text-[11px] text-white/90">
            暂无图片
          </span>
        )}
      </div>

      {/* 缩略图条 */}
      {hasImages && list.length > 1 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {list.map((f, i) => (
            <button
              key={f}
              onClick={() => setIdx(i)}
              className={
                "h-14 w-16 shrink-0 overflow-hidden rounded-md border transition-colors " +
                (i === current ? "border-tcm-jade" : "border-border hover:border-tcm-jade/50")
              }
            >
              <img src={src(f)} alt={`${name} 缩略图 ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== 通用区块 / 行 / 富文本 =====
function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 border-b border-border pb-2.5 font-serif text-lg font-semibold text-tcm-ink">
        <span className="text-tcm-jade">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[76px_1fr] gap-2 text-sm sm:grid-cols-[92px_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className="leading-relaxed text-foreground/90 [&_b]:font-semibold [&_b]:text-tcm-ink"
        dangerouslySetInnerHTML={{ __html: formatRich(value) }}
      />
    </div>
  );
}

function Prose({ value, className = "" }: { value: string; className?: string }) {
  return (
    <div
      className={
        "text-sm leading-relaxed text-foreground/90 [&_b]:font-semibold [&_b]:text-tcm-ink " + className
      }
      dangerouslySetInnerHTML={{ __html: formatRich(value) }}
    />
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "jade" | "gold" | "cinnabar";
}) {
  const color =
    tone === "jade"
      ? "text-tcm-jade"
      : tone === "gold"
        ? "text-tcm-gold"
        : tone === "cinnabar"
          ? "text-tcm-cinnabar"
          : "text-foreground";
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"mt-0.5 truncate text-sm font-semibold " + color} title={value}>
        {value}
      </div>
    </div>
  );
}

function HerbDetailSkeleton() {
  return (
    <div className="animate-fade-in">
      <div className="mb-4 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 正在载入药材详情…
      </div>
      <div className="grid gap-5 rounded-2xl border border-border bg-card p-4 sm:p-6 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <Skeleton className="aspect-[4/3] w-full rounded-xl" />
        <div className="space-y-3">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    </div>
  );
}
