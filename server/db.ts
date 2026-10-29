import { Database } from "bun:sqlite";

// 数据源已迁移到本地 SQLite（见 server/migrate.ts）。
// 数据库文件：tcm-site/data/zysj.sqlite（单文件，部署无需 MariaDB）。
const DB_PATH = import.meta.dir + "/../data/zysj.sqlite";

const db = new Database(DB_PATH, { readonly: false, create: false });
db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;");

// SQLite 原生不支持 REGEXP，注册一个用户函数，使现有 SQL（如 yian/zaji 的
// `BiaoTi REGEXP '...'`、拼音首字母 `... REGEXP '^[A-Z]$'`）继续可用。
// 注意：SQLite 中 `X REGEXP Y` 会调用 regexp(Y, X)。
db.function("regexp", (pattern: string, value: any) => {
  if (value == null) return 0;
  try {
    return new RegExp(pattern).test(String(value)) ? 1 : 0;
  } catch {
    return 0;
  }
});

export async function query<T = any>(sql: string, params: any[] = []): Promise<T> {
  return db.query(sql).all(...params) as T;
}

export async function queryRows<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return db.query(sql).all(...params) as T[];
}

export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const row = db.query(sql).get(...params);
  return (row ?? null) as T | null;
}

export async function dbAlive(): Promise<boolean> {
  try {
    db.query("SELECT 1").get();
    return true;
  } catch {
    return false;
  }
}
