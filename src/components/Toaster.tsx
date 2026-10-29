// 轻量提示组件（仅依赖 framer-motion + lucide，未引入新 UI 框架）
// 支持成功 / 失败 / 普通提示，并可挂一个操作按钮（如「撤销」）。
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

export interface ToastItem {
  id: number;
  type: "success" | "error" | "info";
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface PushOptions {
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (type: ToastItem["type"], text: string, opts: PushOptions = {}) => {
      const id = ++seq.current;
      setToasts((list) => [...list.slice(-2), { id, type, text, actionLabel: opts.actionLabel, onAction: opts.onAction }]);
      const ms = opts.duration ?? (opts.actionLabel ? 6000 : 3200);
      const timer = setTimeout(() => dismiss(id), ms);
      timers.current.set(id, timer);
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  return {
    toasts,
    dismiss,
    success: (text: string, opts?: PushOptions) => push("success", text, opts),
    error: (text: string, opts?: PushOptions) => push("error", text, opts),
    info: (text: string, opts?: PushOptions) => push("info", text, opts),
  };
}

const ICON = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

const TONE = {
  success: "text-tcm-jade",
  error: "text-tcm-cinnabar",
  info: "text-tcm-gold",
};

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = ICON[t.type];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="pointer-events-auto flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-lg"
            >
              <Icon className={"h-4 w-4 shrink-0 " + TONE[t.type]} />
              <span className="min-w-0 flex-1 truncate text-foreground/90">{t.text}</span>
              {t.actionLabel && (
                <button
                  onClick={() => {
                    t.onAction?.();
                    onDismiss(t.id);
                  }}
                  className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-tcm-jade transition-colors hover:bg-tcm-jade/10"
                >
                  {t.actionLabel}
                </button>
              )}
              <button
                onClick={() => onDismiss(t.id)}
                aria-label="关闭提示"
                className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
