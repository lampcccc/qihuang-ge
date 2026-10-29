import type {
  HomeResult,
  ListResult, ResourceResult, SearchResult, GlossaryTerm, Textbook, ExamResource, ManualSection, ModuleInfo,
  HerbsResult, BookListResult, BookTocResult, NatureFlavorMatrix,
  PrescriptionsResult, PrescriptionDetail, RxInput, HerbSuggestion,
} from "./types";

// API 基址：浏览器环境用相对路径（开发走 Vite 代理 / 生产由 Bun 同端口托管），
// 桌面端（Tauri）下前端通过 tauri:// 协议加载，需指向本地 Bun 后端。
const API_BASE =
  typeof window !== "undefined" && (window as any).__TAURI__
    ? "http://127.0.0.1:3801"
    : "";

// 前端缓存（重复查询直接命中，提升响应速度）
const mem = new Map<string, { v: any; t: number }>();
const TTL = 90_000;

// noStore：跳过浏览器 HTTP 缓存。汤方会被增删改，而所有 API 响应都带
// `Cache-Control: public, max-age=60`，若不跳过，写操作后 60s 内列表仍是旧内容。
async function get<T>(path: string, useCache = true, noStore = false): Promise<T> {
  const url = API_BASE + path;
  if (useCache) {
    const c = mem.get(url);
    if (c && Date.now() - c.t < TTL) return c.v as T;
  }
  const res = await fetch(url, noStore ? { cache: "no-store" } : undefined);
  if (!res.ok) throw new Error(`请求失败：${res.status}`);
  const data = (await res.json()) as T;
  if (useCache) mem.set(url, { v: data, t: Date.now() });
  return data;
}

// 写入类请求（POST / PUT / DELETE）：统一处理非 2xx 与后端返回的 errors[]
async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => null)) as (T & { errors?: string[] }) | null;
  if (!res.ok) {
    throw new Error(data?.errors?.join("；") || `请求失败：${res.status}`);
  }
  if (data && Array.isArray(data.errors) && data.errors.length) {
    throw new Error(data.errors.join("；"));
  }
  return data as T;
}

// 清除以 prefix 开头的缓存项（合并 / 撤销 / 拆分后用于强制刷新列表与计数）
function invalidate(prefix: string) {
  for (const k of Array.from(mem.keys())) if (k.includes(prefix)) mem.delete(k);
}

export const api = {
  invalidate,
  home: () => get<HomeResult>("/api/home"),
  modules: () => get<{ modules: ModuleInfo[]; glossaryCount: number; textbookCount: number; examCount: number }>("/api/modules"),
  list: (module: string, page = 1, q?: string) =>
    get<ListResult>(`/api/list?module=${encodeURIComponent(module)}&page=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  resource: (module: string, id: string) =>
    get<ResourceResult>(`/api/resource?module=${encodeURIComponent(module)}&id=${encodeURIComponent(id)}`),
  search: (q: string, page = 1) =>
    get<SearchResult>(`/api/search?q=${encodeURIComponent(q)}&page=${page}`),
  books: (q?: string, page = 1) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (page > 1) sp.set("page", String(page));
    const qs = sp.toString();
    return get<BookListResult>(`/api/books${qs ? `?${qs}` : ""}`);
  },
  bookToc: (typeId: number | string, q?: string) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    const qs = sp.toString();
    return get<BookTocResult>(`/api/book/${typeId}${qs ? `?${qs}` : ""}`);
  },
  glossary: (q?: string, cat?: string) =>
    get<{ items: GlossaryTerm[]; categories: string[] }>(
      `/api/glossary${q ? `?q=${encodeURIComponent(q)}` : ""}${cat ? `${q ? "&" : "?"}cat=${encodeURIComponent(cat)}` : ""}`
    ),
  textbooks: () => get<{ items: Textbook[] }>("/api/textbooks"),
  exam: () => get<{ items: ExamResource[] }>("/api/exam"),
  manual: () => get<{ sections: ManualSection[] }>("/api/manual"),
  herbs: (params: { q?: string; letter?: string; nature?: string; flavor?: string; effect?: string; meridian?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params.q) sp.set("q", params.q);
    if (params.letter) sp.set("letter", params.letter);
    if (params.nature) sp.set("nature", params.nature);
    if (params.flavor) sp.set("flavor", params.flavor);
    if (params.effect) sp.set("effect", params.effect);
    if (params.meridian) sp.set("meridian", params.meridian);
    if (params.page && params.page > 1) sp.set("page", String(params.page));
    const qs = sp.toString();
    return get<HerbsResult>(`/api/herbs${qs ? `?${qs}` : ""}`);
  },
  herb: (id: string) => get<ResourceResult>(`/api/herb/${encodeURIComponent(id)}`, false),
  // 药材名联想（汤方组成录入用）
  herbSuggest: (q: string) => get<{ items: HerbSuggestion[] }>(`/api/herb-suggest?q=${encodeURIComponent(q)}`),
  herbsMatrix: () => get<NatureFlavorMatrix>("/api/herbs/matrix"),

  // ===== 汤方 =====
  prescriptions: (params: { q?: string; letter?: string; origin?: string; effect?: string; herb?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params.q) sp.set("q", params.q);
    if (params.letter) sp.set("letter", params.letter);
    if (params.origin) sp.set("origin", params.origin);
    if (params.effect) sp.set("effect", params.effect);
    if (params.herb) sp.set("herb", params.herb);
    if (params.page && params.page > 1) sp.set("page", String(params.page));
    const qs = sp.toString();
    return get<PrescriptionsResult>(`/api/prescriptions${qs ? `?${qs}` : ""}`, true, true);
  },
  // 详情不做前端缓存：编辑 / 删除 / 还原后需立即看到最新内容
  prescription: (id: string) => get<PrescriptionDetail>(`/api/prescription/${encodeURIComponent(id)}`, false, true),
  // 写操作成功后清掉列表与详情缓存（后端自身也有版本化缓存键，这里同步前端）
  createRx: (input: RxInput) =>
    send<{ ok: boolean; id: string }>("/api/prescriptions", "POST", input).then((r) => {
      invalidate("/api/prescriptions");
      return r;
    }),
  updateRx: (id: string, input: RxInput) =>
    send<{ ok: boolean }>(`/api/prescription/${encodeURIComponent(id)}`, "PUT", input).then((r) => {
      invalidate("/api/prescription");
      return r;
    }),
  deleteRx: (id: string) =>
    send<{ ok: boolean }>(`/api/prescription/${encodeURIComponent(id)}`, "DELETE").then((r) => {
      invalidate("/api/prescription");
      return r;
    }),
  restoreRx: (id: string) =>
    send<{ ok: boolean }>(`/api/prescription/${encodeURIComponent(id)}/restore`, "POST").then((r) => {
      invalidate("/api/prescription");
      return r;
    }),
  resetRx: (id: string) =>
    send<{ ok: boolean }>(`/api/prescription/${encodeURIComponent(id)}/reset`, "POST").then((r) => {
      invalidate("/api/prescription");
      return r;
    }),
};
