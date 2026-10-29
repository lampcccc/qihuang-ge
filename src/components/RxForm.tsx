import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Trash2, Save, Leaf } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { RxInput, PrescriptionDetail, HerbSuggestion } from "@/lib/types";

let seq = 0;
interface Row {
  key: string;
  name: string;
  note: string;
  dosage: string;
  herbId: number | null;
}

const emptyRow = (): Row => ({ key: `r${++seq}`, name: "", note: "", dosage: "", herbId: null });

// 与后端 validateRx 保持同一套规则（名称必填 / 组成至少 1 味 / 用量格式 / 各字段长度），
// 前端先拦截一次，避免无谓往返；后端仍会再校验一次，两处口径一致。
function validate(form: RxInput): string[] {
  const errors: string[] = [];
  const name = (form.MingCheng || "").trim();
  if (!name) errors.push("汤方名称不能为空");
  else if (name.length > 60) errors.push("汤方名称不能超过 60 个字符");

  const comp = (form.composition ?? []).filter((c) => (c.name || "").trim());
  if (comp.length === 0) errors.push("组成至少需要 1 味药材");
  if (comp.length > 60) errors.push("组成药材最多 60 味");
  for (const c of comp) {
    if ((c.name || "").trim().length > 30) {
      errors.push(`组成药材名「${(c.name || "").slice(0, 10)}…」超过 30 个字符`);
    }
    const d = (c.dosage || "").trim();
    if (d && !/^\d+(\.\d+)?\s*(g|克|ml|毫升|mg|钱|两|分|枚|片|粒|丸|滴|袋|付|剂)?$/.test(d)) {
      errors.push(`用量「${d}」格式不正确，应为数字加单位（如 6g、9克）或留空`);
    }
  }
  const longs: [keyof RxInput, string, number][] = [
    ["GongNengZZ", "功效与适应症", 2000],
    ["YongFaYL", "煎煮与服用方法", 2000],
    ["ZhuYi", "禁忌", 1000],
    ["BeiZhu", "备注", 1000],
    ["PaoZhi", "制法", 2000],
    ["ChuFang", "组成原文", 2000],
    ["PinYin", "拼音", 60],
    ["BieMing", "别名", 200],
    ["ZhaiLu", "出处", 200],
  ];
  for (const [key, label, max] of longs) {
    const v = form[key];
    if (v && String(v).length > max) errors.push(`${label}不能超过 ${max} 个字符`);
  }
  return errors;
}

export function RxForm({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: PrescriptionDetail | null; // null = 新建
  onSaved: (r: { mode: "create" | "update"; id: string; title: string }) => void;
}) {
  const [MingCheng, setMingCheng] = useState("");
  const [PinYin, setPinYin] = useState("");
  const [BieMing, setBieMing] = useState("");
  const [ZhaiLu, setZhaiLu] = useState("");
  const [YongFaYL, setYongFaYL] = useState("");
  const [GongNengZZ, setGongNengZZ] = useState("");
  const [ZhuYi, setZhuYi] = useState("");
  const [BeiZhu, setBeiZhu] = useState("");
  const [PaoZhi, setPaoZhi] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // 打开 / 切换编辑对象时重建表单
  useEffect(() => {
    if (!open) return;
    setErrors([]);
    if (editing) {
      setMingCheng(editing.title);
      setPinYin(editing.pinyin);
      setBieMing(editing.alias);
      setZhaiLu(editing.origin === "其他" ? "" : editing.origin);
      setYongFaYL(editing.usage);
      setGongNengZZ(editing.gongneng);
      setZhuYi(editing.taboo);
      setBeiZhu(editing.remark);
      setPaoZhi(editing.prep);
      setRows(
        editing.composition.length
          ? editing.composition.map((c) => ({
              key: `r${++seq}`,
              name: c.name,
              note: c.note,
              dosage: c.dosage,
              herbId: c.herbId,
            }))
          : [emptyRow()]
      );
    } else {
      setMingCheng("");
      setPinYin("");
      setBieMing("");
      setZhaiLu("");
      setYongFaYL("");
      setGongNengZZ("");
      setZhuYi("");
      setBeiZhu("");
      setPaoZhi("");
      setRows([emptyRow()]);
    }
  }, [open, editing]);

  const setRow = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);
  const removeRow = (key: string) =>
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));

  function buildInput(): RxInput {
    return {
      MingCheng: MingCheng.trim(),
      PinYin: PinYin.trim(),
      BieMing: BieMing.trim(),
      ZhaiLu: ZhaiLu.trim(),
      YongFaYL: YongFaYL.trim(),
      GongNengZZ: GongNengZZ.trim(),
      ZhuYi: ZhuYi.trim(),
      BeiZhu: BeiZhu.trim(),
      PaoZhi: PaoZhi.trim(),
      composition: rows
        .filter((r) => r.name.trim())
        .map((r) => ({
          name: r.name.trim(),
          note: r.note.trim(),
          dosage: r.dosage.trim(),
          herbId: r.herbId,
        })),
    };
  }

  async function submit() {
    const input = buildInput();
    const errs = validate(input);
    setErrors(errs);
    if (errs.length) return;
    setSaving(true);
    try {
      if (editing) {
        await api.updateRx(editing.id, input);
        onSaved({ mode: "update", id: editing.id, title: input.MingCheng });
      } else {
        const r = await api.createRx(input);
        onSaved({ mode: "create", id: r.id, title: input.MingCheng });
      }
      onOpenChange(false);
    } catch (e) {
      setErrors([(e as Error).message || "保存失败，请稍后重试"]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{editing ? "编辑汤方" : "新建汤方"}</DialogTitle>
        <DialogDescription>
          字段命名与校验规则沿用中药材模块；源库方剂的修改以覆盖层保存，源数据不受影响。
        </DialogDescription>

        <div className="mt-4 space-y-4">
          {/* 名称 / 拼音 / 别名 / 出处 */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="汤方名称" required>
              <Input value={MingCheng} onChange={(e) => setMingCheng(e.target.value)} placeholder="如 小柴胡汤" maxLength={60} />
            </Field>
            <Field label="拼音">
              <Input value={PinYin} onChange={(e) => setPinYin(e.target.value)} placeholder="如 xiaochaihutang" maxLength={60} />
            </Field>
            <Field label="别名">
              <Input value={BieMing} onChange={(e) => setBieMing(e.target.value)} placeholder="多个别名用「、」分隔" maxLength={200} />
            </Field>
            <Field label="出处">
              <Input value={ZhaiLu} onChange={(e) => setZhaiLu(e.target.value)} placeholder="如 《伤寒论》" maxLength={200} />
            </Field>
          </div>

          {/* 组成药材 */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground/80">
              <span>组成药材</span>
              <span className="text-tcm-cinnabar">*</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                药名 尽量使用药材库中的正名，可自动建立关联；用量填数字加单位（如 9g）
              </span>
            </div>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <CompositionRowInput
                  key={r.key}
                  index={i}
                  row={r}
                  canRemove={rows.length > 1}
                  onChange={(patch) => setRow(r.key, patch)}
                  onRemove={() => removeRow(r.key)}
                />
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={addRow}>
              <Plus className="h-3.5 w-3.5" /> 添加药材
            </Button>
          </div>

          {/* 煎煮服用 / 功效 / 禁忌 / 备注 / 制法 */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="煎煮与服用方法">
              <Textarea value={YongFaYL} onChange={(e) => setYongFaYL(e.target.value)} placeholder="如 水煎，去滓再煎，温服" maxLength={2000} />
            </Field>
            <Field label="功效与适应症">
              <Textarea value={GongNengZZ} onChange={(e) => setGongNengZZ(e.target.value)} placeholder="如 和解少阳。主伤寒邪在少阳" maxLength={2000} />
            </Field>
            <Field label="禁忌">
              <Textarea value={ZhuYi} onChange={(e) => setZhuYi(e.target.value)} placeholder="如 阴虚血少者慎用" maxLength={1000} />
            </Field>
            <Field label="备注">
              <Textarea value={BeiZhu} onChange={(e) => setBeiZhu(e.target.value)} placeholder="补充说明" maxLength={1000} />
            </Field>
          </div>
          <Field label="制法（炮制 / 制剂方法）">
            <Textarea value={PaoZhi} onChange={(e) => setPaoZhi(e.target.value)} placeholder="如 上七味，以水一斗二升，煮取六升" maxLength={2000} />
          </Field>

          {errors.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-tcm-cinnabar/40 bg-tcm-cinnabar/5 p-3 text-xs text-tcm-cinnabar">
              {errors.map((e) => (
                <li key={e}>· {e}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline" size="sm">取消</Button>
          </DialogClose>
          <Button size="sm" onClick={submit} disabled={saving} className="bg-tcm-jade hover:bg-tcm-jade/90">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {editing ? "保存修改" : "创建汤方"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-xs font-medium text-foreground/80">
        {label}
        {required && <span className="ml-0.5 text-tcm-cinnabar">*</span>}
      </div>
      {children}
    </label>
  );
}

// 组成行：药名（带药材库联想）+ 炮制标注 + 用量
function CompositionRowInput({
  row,
  index,
  canRemove,
  onChange,
  onRemove,
}: {
  row: Row;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const [sugg, setSugg] = useState<HerbSuggestion[]>([]);
  const [suggOpen, setSuggOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 输入药名时联想药材库（沿用 /api/herbs，90s 前端缓存，避免频繁请求）
  function onNameChange(v: string) {
    onChange({ name: v, herbId: null });
    if (timer.current) clearTimeout(timer.current);
    if (!v.trim()) {
      setSugg([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        // 用专用的药材名联想接口（只按药名 / 别名匹配、正名优先）。
        // 不用 /api/herbs：那是全文检索（功效、归经都参与匹配）且按名称内码排序，
        // 输入「甘草」时正名会被大量「功能主治里提到甘草」的药材挤到后面。
        const q = v.trim();
        const res = await api.herbSuggest(q);
        setSugg(res.items.slice(0, 8));
        setSuggOpen(true);
      } catch {
        setSugg([]);
      }
    }, 300);
  }

  const matched = useMemo(() => row.herbId != null, [row.herbId]);

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <span className="w-6 shrink-0 text-center text-xs text-muted-foreground">{index + 1}</span>
      <div className="relative min-w-[10rem] flex-1">
        <Input
          value={row.name}
          onChange={(e) => onNameChange(e.target.value)}
          onFocus={() => sugg.length > 0 && setSuggOpen(true)}
          onBlur={() => setTimeout(() => setSuggOpen(false), 150)}
          placeholder="药材名"
          maxLength={30}
          className={matched ? "border-tcm-jade/60" : ""}
        />
        {suggOpen && sugg.length > 0 && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
            {sugg.map((s) => (
              <button
                key={String(s.id)}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange({ name: s.title, herbId: Number(s.id) });
                  setSuggOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-tcm-jade/10"
              >
                <Leaf className="h-3.5 w-3.5 shrink-0 text-tcm-jade" />
                <span className="truncate text-foreground/90">{s.title}</span>
                {s.pinyin && <span className="ml-auto truncate text-xs text-muted-foreground">{s.pinyin}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <Input
        value={row.note}
        onChange={(e) => onChange({ note: e.target.value })}
        placeholder="炮制标注（选填）"
        className="w-32 shrink-0"
        maxLength={30}
      />
      <Input
        value={row.dosage}
        onChange={(e) => onChange({ dosage: e.target.value })}
        placeholder="用量 如 9g"
        className="w-28 shrink-0"
        maxLength={20}
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        title={canRemove ? "移除该药材" : "至少保留 1 味药材"}
        aria-label={`移除第 ${index + 1} 味药材`}
        className={
          "shrink-0 rounded-md border border-border bg-card p-1.5 transition-colors " +
          (canRemove ? "text-muted-foreground hover:border-tcm-cinnabar/50 hover:text-tcm-cinnabar" : "cursor-not-allowed text-muted-foreground/40")
        }
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
