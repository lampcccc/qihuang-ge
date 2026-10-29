import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-9 w-9", className)} aria-label="岐黄阁">
      <rect x="3" y="3" width="42" height="42" rx="6" fill="#b5341f" />
      <rect x="3" y="3" width="42" height="42" rx="6" fill="none" stroke="#c89028" strokeWidth="2" />
      <text
        x="24"
        y="31"
        textAnchor="middle"
        fontSize="22"
        fontFamily="'Noto Serif SC', serif"
        fontWeight="700"
        fill="#fdfcf8"
      >
        岐
      </text>
    </svg>
  );
}
