import { test } from "node:test";
import assert from "node:assert/strict";
import { verdictHash, canonicalJson, chainStatus, anchorVerdict } from "../src/lib/chain.ts";

test("verdictHash is independent of key order (deep)", () => {
  const a = { decision: "reject", order: { side: "buy", instId: "BTC-USDT", sz: "0.01" }, evidence: [{ id: 1, src: "atk" }] };
  const b = { evidence: [{ src: "atk", id: 1 }], order: { sz: "0.01", instId: "BTC-USDT", side: "buy" }, decision: "reject" };
  assert.equal(verdictHash(a), verdictHash(b));
  assert.match(verdictHash(a), /^0x[0-9a-f]{64}$/);
});

test("verdictHash changes with content and array order", () => {
  assert.notEqual(verdictHash({ d: "approve" }), verdictHash({ d: "reject" }));
  assert.notEqual(verdictHash([1, 2]), verdictHash([2, 1]));
});

test("canonical JSON drops undefined, stringifies bigint, is stable", () => {
  assert.equal(canonicalJson({ b: 1n, a: undefined, c: null }), '{"b":"1","c":null}');
  assert.equal(verdictHash({ x: 1, y: undefined }), verdictHash({ x: 1 }));
  // Known keccak256("{}") — guards against accidental encoding changes.
  assert.equal(verdictHash({}), "0xb48d38f93eaa084033fc5970bf96e559c33c4cdc07d889ab00b4d63f9590739d");
});

test("anchorVerdict refuses with a Turkish error when not configured", async () => {
  const saved = { ...process.env };
  delete process.env.CHAIN_PRIVATE_KEY;
  delete process.env.CHAIN_REGISTRY;
  delete process.env.CHAIN_AGENT_ID;
  try {
    assert.equal(chainStatus().configured, false);
    await assert.rejects(
      anchorVerdict({ verdictId: "v1", hash: verdictHash({}), decision: "approve", subject: "t" }),
      /yapılandırılmamış/,
    );
  } finally {
    process.env = saved;
  }
});
