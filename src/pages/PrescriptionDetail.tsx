import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Loader2, Soup, Leaf, Beaker, ScrollText, AlertTriangle, StickyNote,
  CookingPot, Pencil, Trash2, RotateCcw, Undo2, Link2, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ToastStack, useToasts } from "@/components/Toaster";
import { RxForm } from "@/components/RxForm";
import { useAsync } from "@/lib/useAsync";
import { api } from "@/lib/api";
import type { PrescriptionDetail as Rx } from "@/lib/types";

export function PrescriptionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const { data: rx, loading } = useAsync<Rx | null>(
    () => (id ? api.prescription(id) : Promise.resolve(null)),
    [id, tick]
  );
  const { toasts, dismiss, success, error: toastError, info: toastInfo } = useToasts();
  const [formOpen, setFormOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 源库方剂「删除」= 隐藏。删除后不再重新请求详情（接口会返回 404），
  // 而是本地切到已隐藏状态，便于就地撤销。
  const [hidden, setHidden] = useState(false);

  const reload = () => {
    api.invalidate("/api/prescription");
    setTick((t) => t + 1);
  };

  if (loading) return <RxDetailSkeleton />;

  if (!rx) {
    return (
      <div className="animate-fade-in">
        <BackBar title="未找到该汤方" />
        <div className="rounded-xl border border-border bg-card p-10 text-center text-muted-foreground">
          未找到该汤方，可能已被删除或链接有误。
          <div className="mt-4">
            <Button asChild variant="outline">
              <Link to="/prescriptions">返回汤方列表</Link>
            </Button>
          </div>
        </div>
        <ToastStack toasts={toasts} onDismiss={dismiss} />
      </div>
    );
  }

  // 源库方剂被隐藏后：不请求详情（接口会 404），就地展示隐藏状态与撤销入口
  if (hidden) {
    const undoDelete = async () => {
      try {
        await api.restoreRx(rx.id);
        api.invalidate("/api/prescriptions");
        setHidden(false);
        reload();
        toastInfo(`已恢复汤方「${rx.title}」`);
      } catch (e) {
        toastError((e as Error).message || "恢复失败");
      }
    };
    return (
      <div className="animate-fade-in">
        <BackBar title={rx.title} />
        <div className="rounded-2xl border border-dashed border-tcm-gold/40 bg-tcm-gold/5 p-8 text-center">
          <Trash2 className="mx-auto h-9 w-9 text-tcm-gold" />
          <h1 className="mt-3 font-serif text-2xl font-bold text-tcm-ink">{rx.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            该汤方已在本站隐藏，不会出现在列表中；源数据库内容未作任何改动。
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button onClick={undoDelete} className="bg-tcm-jade hover:bg-tcm-jade/90">
              <Undo2 className="h-3.5 w-3.5" /> 撤销删除
            </Button>
            <Button asChild variant="outline">
              <Link to="/prescriptions">返回汤方列表</Link>
            </Button>
          </div>
        </div>
        <ToastStack toasts={toasts} onDismiss={dismiss} />
      </div>
    );
  }

  // 源库方剂：删除 = 加入隐藏名单（源数据不动，可撤销）；自建方剂：真删除（不可撤销，故需二次确认）
  async function doDelete() {
    try {
      await api.deleteRx(rx!.id);
      setConfirmDelete(false);
      api.invalidate("/api/prescriptions");
      if (rx!.custom) {
        navigate("/prescriptions");
        success(`已删除自建汤方「${rx!.title}」`);
      } else {
        setHidden(true);
        toastInfo(`已隐藏汤方「${rx!.title}」`);
      }
    } catch (e) {
      toastError((e as Error).message || "删除失败");
    }
  }

  async function doReset() {
    try {
      await api.resetRx(rx!.id);
      reload();
      toastInfo("已还原为源库原始内容");
    } catch (e) {
      toastError((e as Error).message || "还原失败");
    }
  }

  return (
    <div className="animate-fade-in">
      <BackBar title={rx.title} />

      {/* ===== 头部 ===== */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-serif text-3xl font-bold leading-tight text-tcm-ink sm:text-4xl">{rx.title}</h1>
              {rx.custom ? (
                <Badge variant="gold">自建</Badge>
              ) : (
                <Badge variant="outline">源库方剂</Badge>
              )}
              {rx.isOverridden && <Badge variant="jade">已修改</Badge>}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {rx.pinyin && <span className="text-tcm-jade">{rx.pinyin}</span>}
              {rx.alias && <span>别名：{rx.alias}</span>}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {rx.effect && rx.effect !== "其他" && <Badge variant="jade">{rx.effect}</Badge>}
              {rx.origin && rx.origin !== "其他" && <Badge variant="outline">出自 {rx.origin}</Badge>}
              <Badge variant="outline">{rx.composition.length} 味药材</Badge>
            </div>
          </div>

          {/* 操作区 */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setFormOpen(true)}>
              <Pencil className="h-3.5 w-3.5" /> 编辑
            </Button>
            {!rx.custom && rx.isOverridden && (
              <Button variant="outline" size="sm" onClick={doReset} title="撤销对本方剂的修改，恢复源库原始内容">
                <RotateCcw className="h-3.5 w-3.5" /> 还原原值
              </Button>
            )}
            {confirmDelete ? (
              <>
                <Button
                  size="sm"
                  onClick={doDelete}
                  className="bg-tcm-cinnabar hover:bg-tcm-cinnabar/90"
                  title={rx.custom ? "自建汤方删除后无法恢复" : "源库方剂仅隐藏，可撤销"}
                >
                  确认删除
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  取消
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                className="text-tcm-cinnabar hover:border-tcm-cinnabar/50"
              >
                <Trash2 className="h-3.5 w-3.5" /> 删除
              </Button>
            )}
          </div>
        </div>
        {confirmDelete && (
          <p className="mt-2 rounded-lg border border-tcm-cinnabar/40 bg-tcm-cinnabar/5 p-2 text-xs text-tcm-cinnabar">
            {rx.custom
              ? "自建汤方将被彻底删除，且无法撤销。"
              : "源库方剂不会被改动，仅在本站隐藏（可从列表移除），删除后可撤销。"}
          </p>
        )}
      </div>

      {/* ===== 主体 ===== */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* 组成药材 */}
          <Section icon={<Leaf className="h-4 w-4" />} title="组成药材">
            {rx.composition.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-tcm-jade/[0.06] text-xs text-muted-foreground">
                    <tr>
                      <th className="w-10 px-3 py-2 text-left font-medium">序</th>
                      <th className="px-3 py-2 text-left font-medium">药材</th>
                      <th className="w-28 px-3 py-2 text-left font-medium">炮制标注</th>
                      <th className="w-24 px-3 py-2 text-right font-medium">用量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rx.composition.map((c, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2">
                          {c.matched && c.herbId != null ? (
                            <Link
                              to={`/herbs/${c.herbId}`}
                              className="inline-flex items-center gap-1 font-medium text-tcm-jade hover:underline"
                              title="查看该药材详情"
                            >
                              {c.name}
                              <Link2 className="h-3 w-3" />
                            </Link>
                          ) : (
                            <span className="text-foreground/70" title="未能关联到药材库，保留原文">
                              {c.name}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{c.note || "—"}</td>
                        <td className="px-3 py-2 text-right font-medium text-tcm-gold">{c.dosage || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">源数据未收录组成信息。</p>
            )}
          </Section>

          {/* 煎煮与服用方法 */}
          {(rx.usage || rx.prep) && (
            <Section icon={<Beaker className="h-4 w-4" />} title="煎煮与服用方法">
              {rx.usage && <Prose value={rx.usage} />}
              {rx.prep && (
                <div className="mt-3">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">制法</div>
                  <Prose value={rx.prep} />
                </div>
              )}
            </Section>
          )}

          {/* 功效与适应症 */}
          {rx.gongneng && (
            <Section icon={<Soup className="h-4 w-4" />} title="功效与适应症">
              <Prose value={rx.gongneng} />
            </Section>
          )}

          {/* 禁忌与备注 */}
          {(rx.taboo || rx.remark) && (
            <Section icon={<AlertTriangle className="h-4 w-4" />} title="禁忌与备注">
              <dl className="space-y-3">
                {rx.taboo && <Row label="禁忌" value={rx.taboo} />}
                {rx.remark && <Row label="备注" value={rx.remark} />}
              </dl>
            </Section>
          )}

          {/* 其余字段（源库方剂的其它分组信息） */}
          {otherFields(rx).length > 0 && (
            <Section icon={<Info className="h-4 w-4" />} title="其他信息">
              <dl className="space-y-3">
                {otherFields(rx).map((f) => (
                  <Row key={f.label} label={f.label} value={f.value} />
                ))}
              </dl>
            </Section>
          )}

          {!rx.composition.length && !rx.usage && !rx.gongneng && !rx.taboo && !rx.remark && (
            <EmptyModules />
          )}
        </div>

        {/* 侧栏 */}
        <div className="space-y-5">
          <div className="rounded-xl border border-tcm-jade/25 bg-tcm-jade/[0.05] p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground/80">方剂速览</h3>
            <dl className="space-y-2 text-xs">
              <MetaRow label="组成药味" value={`${rx.composition.length} 味`} />
              <MetaRow
                label="已关联药材"
                value={`${rx.composition.filter((c) => c.matched).length} 味`}
              />
              <MetaRow label="功效分类" value={rx.effect || "未分类"} />
              <MetaRow label="出处" value={rx.origin || "未详"} />
              {rx.updatedAt && <MetaRow label="最近修改" value={new Date(rx.updatedAt).toLocaleString("zh-CN")} />}
            </dl>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              功效分类由「功效与适应症」文本按规则抽取，与中药材模块同一口径，仅供参考。
            </p>
          </div>

          {/* 组成药材快捷入口 */}
          {rx.composition.some((c) => c.matched && c.herbId != null) && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground/80">组成药材</h3>
              <div className="flex flex-wrap gap-1.5">
                {rx.composition
                  .filter((c) => c.matched && c.herbId != null)
                  .map((c, i) => (
                    <Link
                      key={`${c.herbId}-${i}`}
                      to={`/herbs/${c.herbId}`}
                      className="inline-flex items-center gap-1 rounded-full border border-tcm-jade/40 bg-tcm-jade/5 px-2.5 py-1 text-xs text-tcm-jade transition-colors hover:bg-tcm-jade/10"
                    >
                      {c.name}
                      {c.dosage && <span className="text-tcm-gold">{c.dosage}</span>}
                    </Link>
                  ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card/50 p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground/80">
              <StickyNote className="h-3.5 w-3.5" /> 关于本方
            </h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {rx.custom
                ? "本方为自建汤方，保存在独立库中，不写入源数据库。"
                : "本方来自源库方剂数据（只读）。你的修改以覆盖层保存，原始内容始终保留，可随时还原。"}
            </p>
            {!rx.custom && (
              <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setFormOpen(true)}>
                <Pencil className="h-3.5 w-3.5" /> 编辑本方
              </Button>
            )}
          </div>

          <p className="rounded-xl border border-border bg-card/50 p-4 text-xs leading-relaxed text-muted-foreground">
            内容整理自方剂数据库，仅供学习研究；临床用药请遵医嘱。
          </p>
        </div>
      </div>

      <RxForm
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={rx}
        onSaved={(r) => {
          reload();
          api.invalidate("/api/prescriptions");
          success(r.mode === "create" ? `已创建汤方「${r.title}」` : `已保存「${r.title}」的修改`);
        }}
      />
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// 侧栏小行
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

// 已在主区展示过的字段，不再在「其他信息」里重复（「组成」保留原文，供对照结构化表格）
const SHOWN = new Set(["名称", "拼音", "别名", "出处", "用法用量", "功能主治", "禁忌", "备注", "制法"]);
function otherFields(rx: Rx) {
  const out: { label: string; value: string }[] = [];
  for (const g of rx.groups ?? []) {
    for (const f of g.fields) {
      if (SHOWN.has(f.label)) continue;
      if (!f.value || !String(f.value).trim()) continue;
      if (out.some((x) => x.label === f.label && x.value === f.value)) continue;
      out.push({ label: f.label, value: f.value });
    }
  }
  return out;
}

function EmptyModules() {
  return (
    <section className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
      <ScrollText className="mx-auto h-8 w-8 text-muted-foreground/50" />
      <p className="mt-2 text-sm text-muted-foreground">该方剂暂无组成 / 用法 / 功效 / 禁忌等结构化内容</p>
      <p className="mt-1 text-xs text-muted-foreground">可点击「编辑」补全信息</p>
    </section>
  );
}

function BackBar({ title }: { title: string }) {
  return (
    <div className="mb-4">
      <nav className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-label="面包屑">
        <Link to="/" className="transition-colors hover:text-tcm-jade">首页</Link>
        <span>/</span>
        <Link to="/herbs" className="transition-colors hover:text-tcm-jade">中药材</Link>
        <span>/</span>
        <Link to="/prescriptions" className="transition-colors hover:text-tcm-jade">汤方</Link>
        <span>/</span>
        <span className="truncate text-foreground/80">{title}</span>
      </nav>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => window.history.back()}
        className="mt-2 -ml-2 text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> 返回
      </Button>
    </div>
  );
}

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
      <dd className="leading-relaxed text-foreground/90">{value}</dd>
    </div>
  );
}

function Prose({ value }: { value: string }) {
  return <p className="text-sm leading-relaxed text-foreground/90">{value}</p>;
}

function RxDetailSkeleton() {
  return (
    <div className="animate-fade-in">
      <div className="mb-4 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 正在载入汤方详情…
      </div>
      <Skeleton className="h-32 w-full rounded-2xl" />
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Skeleton className="h-56 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    </div>
  );
}
