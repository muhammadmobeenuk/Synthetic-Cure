import { splitStatements } from "./sql.js";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
export interface DB {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  native: boolean;
}
export async function openDatabase(
  url: string | null = process.env.DATABASE_URL || null,
  directory = process.env.DB_DIR || "runtime/database",
): Promise<DB> {
  if (url) {
    const pool = new Pool({ connectionString: url });
    const wrap = (q: any): DB => ({
      native: true,
      query: (s, p = []) => q.query(s, p),
      close: async () => {},
      transaction: async (f) => f(wrap(q)),
    });
    return {
      ...wrap(pool),
      close: () => pool.end(),
      transaction: async (f) => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const r = await f(wrap(c));
          await c.query("COMMIT");
          return r;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
    };
  }
  if (process.env.NODE_ENV === "production")
    throw new Error("Production requires DATABASE_URL");
  if (directory !== ":memory:") await mkdir(directory, { recursive: true });
  const pg = new PGlite(directory === ":memory:" ? undefined : directory);
  await pg.waitReady;
  let tail = Promise.resolve();
  const tx: DB = {
    native: false,
    query: async (s, p = []) => pg.query(s, p),
    close: () => pg.close(),
    transaction: async (f) => f(tx),
  };
  const locked = async <T>(f: () => Promise<T>) => {
    let release!: () => void;
    const prior = tail;
    tail = new Promise<void>((r) => {
      release = r;
    });
    await prior;
    try {
      return await f();
    } finally {
      release();
    }
  };
  return {
    ...tx,
    query: (s, p = []) => locked(() => pg.query(s, p)),
    transaction: (f) =>
      locked(async () => {
        await pg.query("BEGIN");
        try {
          const r = await f(tx);
          await pg.query("COMMIT");
          return r;
        } catch (e) {
          await pg.query("ROLLBACK");
          throw e;
        }
      }),
  };
}
export async function migrate(db: DB) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const dir = path.resolve("packages/database/migrations");
  for (const name of (await readdir(dir))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      (await db.query("SELECT name FROM migrations WHERE name=$1", [name])).rows
        .length
    )
      continue;
    const sql = await readFile(path.join(dir, name), "utf8");
    await db.transaction(async (tx) => {
      if (!tx.native) {
        for (const statement of splitStatements(sql)) await tx.query(statement);
      } else await tx.query(sql);
      await tx.query("INSERT INTO migrations(name) VALUES($1)", [name]);
    });
  }
}
