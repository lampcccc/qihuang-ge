// 轻量级内存缓存（带 TTL），用于提升重复查询效率
interface Entry {
  value: any;
  exp: number;
}

const store = new Map<string, Entry>();

export function cacheGet(key: string): any | null {
  const e = store.get(key);
  if (!e) return null;
  if (e.exp < Date.now()) {
    store.delete(key);
    return null;
  }
  return e.value;
}

export function cacheSet(key: string, value: any, ttlMs = 120_000): void {
  store.set(key, { value, exp: Date.now() + ttlMs });
}

// 防缓存击穿的简单封装
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cacheGet(key);
  if (hit !== null) return hit as T;
  const v = await fn();
  cacheSet(key, v, ttlMs);
  return v;
}
