// 源库文本清洗的共享实现（原在 index.ts，汤方模块需要复用，故抽出）。
// 索引入口 index.ts 会在模块加载时启动 HTTP 服务，其他模块不可直接 import 它，
// 因此纯工具函数放在这里，避免循环依赖与副作用。
export function decodeEntities(s: string): string {
  if (!s) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; }
    })
    .replace(/&#(\d+);/g, (_, d: string) => {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch { return _; }
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");
}

// 列表/卡片摘要：去标签与标记、压缩空白后截断
export function excerpt(s: any, n = 60): string {
  if (s == null) return "";
  const t = decodeEntities(String(s))
    .replace(/<[^>]+>/g, "")
    .replace(/\[b\]|\[\/b\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

// 正文用：解码后转义，再把 [b]/[p] 标记与换行还原为 HTML（先解码后转义，避免 XSS）
export function formatProse(raw: any): string {
  if (raw == null) return "";
  let s = escapeHtml(decodeEntities(String(raw)));
  s = s.replace(/\[b\]([\s\S]*?)\[\/b\]/g, "<b>$1</b>");
  s = s.replace(/\[p\]([\s\S]*?)\[\/p\]/g, "<p>$1</p>");
  s = s.replace(/\r?\n/g, "<br/>");
  return s;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
