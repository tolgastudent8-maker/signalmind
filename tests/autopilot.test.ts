import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetDbForTests, db } from "../src/lib/db.ts";
import { saveNews } from "../src/lib/news.ts";
import { autopilotCandidates, autopilotSettings, autopilotTick, saveAutopilotSettings } from "../src/lib/autopilot.ts";
import { recoverInterruptedRuns } from "../src/lib/agents/pipeline.ts";

const now = Date.now();

beforeEach(() => {
  resetDbForTests(":memory:");
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  saveNews([
    { id: "a1", source: "CoinDesk", title: "Hex founder Richard Heart arrested in Istanbul on Interpol notice", summary: "", url: null, published_at: now - 20 * 60_000, fetched_at: now },
    { id: "a2", source: "Decrypt", title: "Hex Founder Richard Heart Detained in Istanbul on Interpol Notice", summary: "", url: null, published_at: now - 10 * 60_000, fetched_at: now },
    { id: "b1", source: "The Block", title: "Solana validator client ships new release", summary: "", url: null, published_at: now - 15 * 60_000, fetched_at: now },
    { id: "c1", source: "CoinDesk", title: "Old corroborated story about ETF flows rising", summary: "", url: null, published_at: now - 5 * 3_600_000, fetched_at: now },
    { id: "c2", source: "Decrypt", title: "Old corroborated story: ETF flows rising again", summary: "", url: null, published_at: now - 5 * 3_600_000, fetched_at: now },
  ]);
});

test("autopilot is off by default and never starts work while off", () => {
  assert.equal(autopilotSettings().enabled, false);
  assert.equal(autopilotTick().reason, "kapalı");
});

test("candidates are fresh, corroborated and not yet analysed", () => {
  const c = autopilotCandidates({ enabled: true, dailyCap: 5, minSources: 2 });
  assert.deepEqual(
    c.map((x) => x.sources),
    [2],
  );
  assert.match(c[0].title, /Richard Heart/);
  // With one source allowed, the single-source fresh story qualifies too.
  assert.equal(autopilotCandidates({ enabled: true, dailyCap: 5, minSources: 1 }).length, 2);
});

test("autopilot waits for an API key and respects the settings bounds", () => {
  saveAutopilotSettings({ enabled: true, dailyCap: 999, minSources: 0 });
  const s = autopilotSettings();
  assert.equal(s.dailyCap, 50);
  assert.equal(s.minSources, 1);
  assert.equal(autopilotTick().reason, "API anahtarı yok");
});

test("runs left 'running' by a dead server are closed out on startup", () => {
  db().prepare(`INSERT INTO analyses (id, news_id, mode, status, as_of, created_at) VALUES ('x', 'a1', 'live', 'running', 0, 0)`).run();
  assert.equal(recoverInterruptedRuns(), 1);
  const row = db().prepare(`SELECT status, error FROM analyses WHERE id = 'x'`).get() as { status: string; error: string };
  assert.equal(row.status, "error");
  assert.match(row.error, /yeniden başladı/);
});
