// 一次性迁移脚本：把 MariaDB(zysj) 的三张表迁到本地 SQLite 文件。
// 用 ID 主键区间分块读取（避免大文本一次性入内存，也规避流式事件在某些环境下挂起），
// 写入用 bun:sqlite 事务批量。
import mysql from "mysql2/promise";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "node:fs";

const DATA_DIR = import.meta.dir + "/../data";
mkdirSync(DATA_DIR, { recursive: true });
const SQLITE_PATH = DATA_DIR + "/zysj.sqlite";
rmSync(SQLITE_PATH, { force: true });

const sqlite = new Database(SQLITE_PATH, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF; PRAGMA foreign_keys = OFF;");

const pool = mysql.createPool({
  host: "127.0.0.1",
  port: 3307,
  user: "root",
  database: "zysj",
  charset: "utf8mb4",
  connectionLimit: 2,
});

const TABLES = ["zysjyj", "zysjllsj", "zysjzhsj"];
const CHUNK = 3000;

function mapType(dt: string): string {
  dt = dt.toLowerCase();
  if (/(int|bigint|tinyint|smallint|mediumint)/.test(dt)) return "INTEGER";
  if (/(float|double|decimal|numeric|real)/.test(dt)) return "REAL";
  return "TEXT";
}

async function migrate(t: string) {
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME AS name, DATA_TYPE AS type FROM information_schema.columns
     WHERE table_schema='zysj' AND table_name=? ORDER BY ORDINAL_POSITION`,
    [t]
  );
  const columns = (cols as any[]).map((c) => ({ name: c.name, type: mapType(c.type) }));
  sqlite.exec(`DROP TABLE IF EXISTS "${t}"`);
  sqlite.exec(`CREATE TABLE "${t}" (${columns.map((c) => `"${c.name}" ${c.type}`).join(", ")})`);

  const colNames = columns.map((c) => c.name);
  const placeholders = colNames.map(() => "?").join(", ");
  const stmt = sqlite.prepare(`INSERT INTO "${t}" VALUES (${placeholders})`);
  const clean = (v: any): any => {
    if (v == null) return null;
    if (typeof v === "object") {
      if (v instanceof Date) return v.toISOString().slice(0, 19).replace("T", " ");
      if (Buffer.isBuffer(v)) return v.toString("utf8");
      return JSON.stringify(v);
    }
    return v;
  };
  const txn = sqlite.transaction((batch: any[]) => {
    for (const r of batch) stmt.run(colNames.map((n) => clean(r[n])));
  });

  const [range] = await pool.query(`SELECT MIN(ID) AS lo, MAX(ID) AS hi FROM ${t}`);
  const lo = (range as any[])[0].lo;
  const hi = (range as any[])[0].hi;
  if (lo == null || hi == null) {
    console.log(`✓ ${t}: 0 行（空表）`);
    return;
  }

  let count = 0;
  for (let start = lo; start <= hi; start += CHUNK) {
    const end = start + CHUNK - 1;
    const [rows] = await pool.query(`SELECT * FROM ${t} WHERE ID BETWEEN ? AND ?`, [start, end]);
    if ((rows as any[]).length) {
      txn(rows as any[]);
      count += (rows as any[]).length;
    }
  }
  console.log(`✓ ${t}: ${count} 行`);
}

console.log("开始迁移 ->", SQLITE_PATH);
for (const t of TABLES) await migrate(t);
await pool.end();
sqlite.close();
console.log("迁移完成 ✅");
