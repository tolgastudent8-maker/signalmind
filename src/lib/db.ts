import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  url TEXT,
  published_at INTEGER,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  news_id TEXT NOT NULL REFERENCES news(id),
  mode TEXT NOT NULL CHECK (mode IN ('live','backtest')),
  status TEXT NOT NULL CHECK (status IN ('running','done','error')),
  as_of INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  result_json TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_analyses_created ON analyses(created_at DESC);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id TEXT NOT NULL REFERENCES analyses(id),
  ts INTEGER NOT NULL,
  agent TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  payload_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_analysis ON events(analysis_id, id);
CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id TEXT NOT NULL REFERENCES analyses(id),
  news_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  token TEXT NOT NULL,
  inst_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('up','down','flat')),
  confidence REAL NOT NULL,
  horizon_h INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  mechanism TEXT NOT NULL,
  rationale TEXT NOT NULL,
  entry_ts INTEGER NOT NULL,
  entry_price REAL NOT NULL,
  momentum_dir TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','correct','wrong','nodata')),
  actual_dir TEXT,
  exit_price REAL,
  change_pct REAL,
  evaluated_at INTEGER,
  UNIQUE (analysis_id, token, horizon_h)
);
CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(status, entry_ts);
CREATE INDEX IF NOT EXISTS idx_predictions_token ON predictions(token);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS abstentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id TEXT NOT NULL REFERENCES analyses(id),
  news_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  token TEXT NOT NULL,
  horizon_h INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  model_direction TEXT,
  model_confidence REAL,
  base_prob REAL,
  created_at INTEGER NOT NULL,
  UNIQUE (analysis_id, token, horizon_h)
);
CREATE INDEX IF NOT EXISTS idx_abstentions_analysis ON abstentions(analysis_id);
CREATE TABLE IF NOT EXISTS tr_premium (
  ts INTEGER PRIMARY KEY,
  usdt_try REAL NOT NULL,
  tcmb_mid REAL,
  usdt_premium REAL,
  basket_premium REAL,
  btc_premium REAL,
  eth_premium REAL
);
`;

export function kvGet<T>(key: string): T | null {
  const row = db().prepare(`SELECT value FROM kv WHERE key = ?`).get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : null;
}

export function kvSet(key: string, value: unknown): void {
  db().prepare(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, JSON.stringify(value));
}

/** Additive column migrations for databases created by earlier versions. */
const COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "predictions", column: "model_direction", ddl: "ALTER TABLE predictions ADD COLUMN model_direction TEXT" },
  { table: "predictions", column: "model_confidence", ddl: "ALTER TABLE predictions ADD COLUMN model_confidence REAL" },
  { table: "predictions", column: "rule_note", ddl: "ALTER TABLE predictions ADD COLUMN rule_note TEXT" },
  { table: "news", column: "story_id", ddl: "ALTER TABLE news ADD COLUMN story_id TEXT" },
  { table: "analyses", column: "trigger", ddl: "ALTER TABLE analyses ADD COLUMN trigger TEXT NOT NULL DEFAULT 'manual'" },
  // No-news probability of the predicted outcome at entry; reference forecast for the Brier skill score.
  { table: "predictions", column: "base_prob", ddl: "ALTER TABLE predictions ADD COLUMN base_prob REAL" },
];

function migrate(conn: DatabaseSync) {
  for (const c of COLUMNS) {
    const cols = conn.prepare(`PRAGMA table_info(${c.table})`).all() as { name: string }[];
    if (!cols.some((x) => x.name === c.column)) conn.exec(c.ddl);
  }
  conn.exec("CREATE INDEX IF NOT EXISTS idx_news_story ON news(story_id)");
}

const g = globalThis as unknown as { __signalmindDb?: DatabaseSync; __signalmindMigrations?: string };

/** Changes whenever a table or a column is added, so a kept connection re-applies the schema. */
const SCHEMA_KEY = `${COLUMNS.length}:${SCHEMA.length}`;

export function db(): DatabaseSync {
  // A dev-server hot reload keeps the old connection: still apply newly added tables and columns.
  if (g.__signalmindDb && g.__signalmindMigrations !== SCHEMA_KEY) {
    g.__signalmindDb.exec(SCHEMA);
    migrate(g.__signalmindDb);
    g.__signalmindMigrations = SCHEMA_KEY;
  }
  if (!g.__signalmindDb) {
    const file = process.env.SIGNALMIND_DB ?? path.join(process.cwd(), "data", "signalmind.db");
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    const conn = new DatabaseSync(file);
    conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    conn.exec(SCHEMA);
    migrate(conn);
    g.__signalmindMigrations = SCHEMA_KEY;
    g.__signalmindDb = conn;
  }
  return g.__signalmindDb;
}

/** Test helper: swap in a fresh database. */
export function resetDbForTests(file = ":memory:"): DatabaseSync {
  g.__signalmindDb?.close();
  g.__signalmindDb = undefined;
  process.env.SIGNALMIND_DB = file;
  return db();
}
