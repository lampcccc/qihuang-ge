/**
 * 汤方索引构建（离线脚本，可重复执行 / 覆盖）
 * ------------------------------------------------------------------
 * 用途：解析源库方剂（zysjyj TypeID=39）的「组成 ChuFang」字段，
 *       建立 ① 汤方-药材关联（rx_herbs，kind=0）② 列表筛选所需的元信息（rx_meta）。
 * 只读源库，所有写入都在 data/tcm_rx.sqlite。
 *
 * 运行：bun run server/build_rx.ts
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { queryRows } from "./db";
import { ensureHerbDict, parseComposition, normalizeOrigin, letterOf } from "./prescriptions";
import { detectEffect } from "./effect";
import { decodeEntities } from "./text";

const RX_PATH = join(import.meta.dir, "..", "data", "tcm_rx.sqlite");
const rx = new Database(RX_PATH, { create: true });
rx.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF;");

const norm = (s: any) => decodeEntities(String(s ?? "")).replace(/\s+/g, " ").trim();

await ensureHerbDict(true);

const rows = await queryRows<any>(
  `SELECT ID, MingCheng, PYFile, PinYinZT, ZhaiLu, ChuFang, GongNengZZ
   FROM zysjyj WHERE TypeID = 39 ORDER BY ID`
);
console.log(`[build_rx] 源库方剂 ${rows.length} 条，开始解析组成…`);

// 重建源方剂的解析结果（自建汤方 kind=1 不受影响）
rx.exec("DELETE FROM rx_herbs WHERE kind = 0");
rx.exec("DELETE FROM rx_meta WHERE custom = 0");

const insHerb = rx.prepare(
  "INSERT INTO rx_herbs (rxKey, kind, seq, herbId, name, note, dosage, raw) VALUES (?, 0, ?, ?, ?, ?, ?, ?)"
);
const insMeta = rx.prepare(
  `INSERT INTO rx_meta (rxKey, custom, state, MingCheng, PinYin, letter, effect, origin, herbCount, updatedAt)
   VALUES (?, 0, 0, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(rxKey) DO UPDATE SET
     MingCheng = excluded.MingCheng, PinYin = excluded.PinYin, letter = excluded.letter,
     effect = excluded.effect, origin = excluded.origin, herbCount = excluded.herbCount,
     updatedAt = excluded.updatedAt`
);

const BATCH = 2000;
let compTotal = 0;
let compMatched = 0;
let withComposition = 0;
const unmatched = new Map<string, number>();

rx.exec("BEGIN");
const t0 = Date.now();
for (let i = 0; i < rows.length; i++) {
  const r = rows[i]!;
  const key = `s${r.ID}`;
  const name = norm(r.MingCheng);
  const pinyin = norm(r.PYFile) || norm(r.PinYinZT);
  const comp = parseComposition(r.ChuFang);
  if (comp.length > 0) withComposition++;
  comp.forEach((c, seq) => {
    compTotal++;
    if (c.herbId != null) compMatched++;
    else unmatched.set(c.name, (unmatched.get(c.name) ?? 0) + 1);
    insHerb.run(key, seq, c.herbId, c.name, c.note || "", c.dosage || "", c.raw || "");
  });
  const eff = detectEffect(norm(r.GongNengZZ));
  insMeta.run(key, name, pinyin, letterOf(pinyin, pinyin), eff.effect, normalizeOrigin(r.ZhaiLu), comp.length, Date.now());
  if (i > 0 && i % BATCH === 0) {
    rx.exec("COMMIT");
    rx.exec("BEGIN");
    process.stdout.write(`\r  已处理 ${i}/${rows.length}`);
  }
}
rx.exec("COMMIT");
const ms = Date.now() - t0;

const meta = Number((rx.query("SELECT COUNT(*) AS c FROM rx_meta").get() as any)?.c ?? 0);
console.log(`\n[build_rx] 完成，用时 ${(ms / 1000).toFixed(1)}s`);
console.log(`  元信息 rx_meta      ${meta} 条`);
console.log(`  组成行 rx_herbs     ${compTotal} 行（有组成的汤方 ${withComposition} 首）`);
console.log(`  已关联药材          ${compMatched} 行  关联率 ${(compMatched / Math.max(1, compTotal) * 100).toFixed(1)}%`);
console.log(`  未关联（保留原文）  ${compTotal - compMatched} 行`);
const top = Array.from(unmatched.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15);
if (top.length) console.log("  未关联高频药名（前 15）: " + top.map(([k, v]) => `${k}(${v})`).join("、"));
rx.close();
