import { db, kvGet, kvSet } from "../db.ts";

/**
 * Guard state (audits, their event trace, the trust epoch) behind one async interface.
 * Locally it is the SQLite file. On serverless hosts (Vercel) every request can land on a
 * different instance with its own /tmp, so when Upstash Redis REST credentials are present
 * (KV_REST_API_URL/TOKEN as injected by Vercel's Upstash integration, or UPSTASH_REDIS_REST_*)
 * the same records live in Redis instead. The RSS archive stays per-instance SQLite: it is
 * rebuilt from public feeds and needs no sharing.
 */

export type CheckRecord = {
  id: string;
  bot: string;
  scenario: string | null;
  proposal_json: string;
  status: "running" | "awaiting_human" | "done" | "error";
  decision: string | null;
  final_decision: string | null;
  decided_by: string | null;
  verdict_json: string | null;
  verdict_hash: string | null;
  chain_tx: string | null;
  chain_error: string | null;
  error: string | null;
  created_at: number;
  finished_at: number | null;
};

export type EventRecord = { id: number; ts: number; kind: string; title: string; payload_json: string | null };

export interface GuardStore {
  kind: "sqlite" | "redis";
  insertCheck(r: Pick<CheckRecord, "id" | "bot" | "scenario" | "proposal_json" | "created_at">): Promise<void>;
  updateCheck(id: string, patch: Partial<Omit<CheckRecord, "id">>): Promise<void>;
  getCheck(id: string): Promise<CheckRecord | undefined>;
  /** Newest first. */
  listChecks(limit: number): Promise<CheckRecord[]>;
  /** Every audit of one bot (for its trust), any order. */
  checksOf(bot: string): Promise<CheckRecord[]>;
  addEvent(checkId: string, e: Omit<EventRecord, "id">): Promise<void>;
  listEvents(checkId: string): Promise<EventRecord[]>;
  kvGet<T>(key: string): Promise<T | null>;
  kvSet(key: string, value: unknown): Promise<void>;
}

const EMPTY: Omit<CheckRecord, "id" | "bot" | "scenario" | "proposal_json" | "created_at"> = {
  status: "running",
  decision: null,
  final_decision: null,
  decided_by: null,
  verdict_json: null,
  verdict_hash: null,
  chain_tx: null,
  chain_error: null,
  error: null,
  finished_at: null,
};

const COLS = ["bot", "scenario", "proposal_json", "status", "decision", "final_decision", "decided_by", "verdict_json", "verdict_hash", "chain_tx", "chain_error", "error", "created_at", "finished_at"] as const;

const sqlite: GuardStore = {
  kind: "sqlite",
  async insertCheck(r) {
    db().prepare(`INSERT INTO guard_checks (id, bot, scenario, proposal_json, status, created_at) VALUES (?, ?, ?, ?, 'running', ?)`).run(r.id, r.bot, r.scenario, r.proposal_json, r.created_at);
  },
  async updateCheck(id, patch) {
    const keys = Object.keys(patch).filter((k): k is (typeof COLS)[number] => (COLS as readonly string[]).includes(k));
    if (!keys.length) return;
    db()
      .prepare(`UPDATE guard_checks SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .run(...keys.map((k) => (patch[k] ?? null) as string | number | null), id);
  },
  async getCheck(id) {
    return db().prepare(`SELECT * FROM guard_checks WHERE id = ?`).get(id) as CheckRecord | undefined;
  },
  async listChecks(limit) {
    return db().prepare(`SELECT * FROM guard_checks ORDER BY created_at DESC LIMIT ?`).all(limit) as CheckRecord[];
  },
  async checksOf(bot) {
    return db().prepare(`SELECT * FROM guard_checks WHERE bot = ?`).all(bot) as CheckRecord[];
  },
  async addEvent(checkId, e) {
    db().prepare(`INSERT INTO guard_events (check_id, ts, kind, title, payload_json) VALUES (?, ?, ?, ?, ?)`).run(checkId, e.ts, e.kind, e.title, e.payload_json);
  },
  async listEvents(checkId) {
    return db().prepare(`SELECT id, ts, kind, title, payload_json FROM guard_events WHERE check_id = ? ORDER BY id`).all(checkId) as EventRecord[];
  },
  async kvGet<T>(key: string) {
    return kvGet<T>(key);
  },
  async kvSet(key, value) {
    kvSet(key, value);
  },
};

// ---- Upstash Redis over its REST API (no client library) -------------------------------

function redisCreds(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

async function redis<T = unknown>(...commands: (string | number)[][]): Promise<T[]> {
  const c = redisCreds()!;
  const res = await fetch(`${c.url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
  const out = (await res.json()) as { result?: T; error?: string }[];
  const err = out.find((x) => x.error);
  if (err) throw new Error(`Redis: ${err.error}`);
  return out.map((x) => x.result as T);
}

const K = {
  check: (id: string) => `sg:check:${id}`,
  index: "sg:checks", // zset: created_at → id
  events: (id: string) => `sg:events:${id}`,
  kv: (key: string) => `sg:kv:${key}`,
};

async function readChecks(ids: string[]): Promise<CheckRecord[]> {
  if (!ids.length) return [];
  const raw = await redis<string | null>(...ids.map((id) => ["GET", K.check(id)]));
  return raw.filter((x): x is string => !!x).map((x) => JSON.parse(x) as CheckRecord);
}

const upstash: GuardStore = {
  kind: "redis",
  async insertCheck(r) {
    const rec: CheckRecord = { ...EMPTY, ...r };
    await redis(["SET", K.check(r.id), JSON.stringify(rec)], ["ZADD", K.index, r.created_at, r.id]);
  },
  async updateCheck(id, patch) {
    const cur = await this.getCheck(id);
    if (!cur) return;
    await redis(["SET", K.check(id), JSON.stringify({ ...cur, ...patch })]);
  },
  async getCheck(id) {
    const [raw] = await redis<string | null>(["GET", K.check(id)]);
    return raw ? (JSON.parse(raw) as CheckRecord) : undefined;
  },
  async listChecks(limit) {
    const [ids] = await redis<string[]>(["ZRANGE", K.index, 0, limit - 1, "REV"]);
    return readChecks(ids ?? []);
  },
  async checksOf(bot) {
    const [ids] = await redis<string[]>(["ZRANGE", K.index, 0, -1]);
    return (await readChecks(ids ?? [])).filter((c) => c.bot === bot);
  },
  async addEvent(checkId, e) {
    // The list position is the event id (assigned on read), so appends never race on ids.
    await redis(["RPUSH", K.events(checkId), JSON.stringify(e)]);
  },
  async listEvents(checkId) {
    const [raw] = await redis<string[]>(["LRANGE", K.events(checkId), 0, -1]);
    return (raw ?? []).map((x, i) => ({ ...(JSON.parse(x) as EventRecord), id: i + 1 }));
  },
  async kvGet<T>(key: string) {
    const [raw] = await redis<string | null>(["GET", K.kv(key)]);
    return raw ? (JSON.parse(raw) as T) : null;
  },
  async kvSet(key, value) {
    await redis(["SET", K.kv(key), JSON.stringify(value)]);
  },
};

export function store(): GuardStore {
  return redisCreds() ? upstash : sqlite;
}
