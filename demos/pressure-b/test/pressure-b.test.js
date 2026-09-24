import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { once } from "node:events";
import { after, before, test } from "node:test";

const root = new URL("../", import.meta.url);
const provenance = JSON.parse(await fs.readFile(new URL("provenance.json", root), "utf8"));
const hash = text => crypto.createHash("sha256").update(text).digest("hex");
const normalise = text => text.replace(/\r\n/g, "\n");
const realFetch = globalThis.fetch;
const originalEnv = { ...process.env };
process.env.OPENAI_API_KEY = "test-key-must-never-be-used";
process.env.STUDY_SECRET = "test-secret-must-not-select-condition";
process.env.STUDY_A_CODE = "test-a";
process.env.COACH_RATE_LIMIT = "100";
const { app } = await import("../server.js");
let server;
let base;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
  // Any accidental upstream API call fails this suite; requests stay local.
  globalThis.fetch = (input, options) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    assert.equal(url.origin, base, "The B service must not make an upstream request");
    return realFetch(input, options);
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  for (const name of ["OPENAI_API_KEY", "STUDY_SECRET", "STUDY_A_CODE", "COACH_RATE_LIMIT"]) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

const ask = async (body, headers = {}, query = "") => {
  const response = await fetch(`${base}/api/chat${query}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  assert.equal(response.headers.get("set-cookie"), null);
  return { response, data: await response.json() };
};

test("frontend and original pressure/rule functions match the pinned source", async () => {
  const html = normalise(await fs.readFile(new URL("index.html", root), "utf8"));
  const source = normalise(await fs.readFile(new URL("server.js", root), "utf8"));
  const rules = source.slice(source.indexOf("function ruleBasedCoachReply("), source.indexOf('app.get("/api/health"')).trim();
  const physics = source.slice(source.indexOf("function finiteNumber("), source.indexOf("function readableNumber(")).trim();
  assert.equal(hash(html), provenance.frontendSha256);
  assert.equal(hash(rules), provenance.ruleBasedCoachReplySha256);
  assert.equal(hash(physics), provenance.pressureContextFunctionsSha256);
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.equal(hash(normalise(await response.text())), provenance.frontendSha256);
});

test("health and cookie-free coaching always identify the rule-based B service", async () => {
  const health = await fetch(`${base}/api/health`);
  assert.deepEqual(await health.json(), { ok: true, coachReady: true, condition: "B", source: "rule_based" });
  assert.equal(health.headers.get("set-cookie"), null);
  const { response, data } = await ask({ question: "Why does the pressure graph slope change?" });
  assert.equal(response.status, 200);
  assert.equal(data.source, "rule_based");
  assert.match(data.reply, /A denser fluid makes the graph steeper/);
});

test("even valid A signatures, request fields, and query parameters cannot select AI", async () => {
  const signature = crypto.createHmac("sha256", process.env.STUDY_SECRET).update("A").digest("hex");
  for (const cookie of [
    `ce2134_study_assignment=A.${signature}`,
    `__Host-ce2134_study_assignment=A.${signature}`,
  ]) {
    const { response, data } = await ask({
      question: "Explain pressure units", condition: "A", assignment: "A", model: "any-model", source: "llm",
    }, { cookie, "x-study-condition": "A" }, "?condition=A");
    assert.equal(response.status, 200);
    assert.equal(data.source, "rule_based");
    assert.match(data.reply, /Divide by 1000 to report kilopascals/);
  }
  const study = await fetch(`${base}/study/a/test-a`, { redirect: "manual" });
  assert.equal(study.status, 404);
  assert.equal(study.headers.get("set-cookie"), null);
});

test("original numerical pressure response and challenge answer-hiding remain intact", async () => {
  const context = { sensorDepth: 2, bottomDensity: 1000, bottomLayerDepth: 3 };
  const solved = await ask({ question: "Explain this result", context });
  assert.equal(solved.data.source, "rule_based");
  assert.match(solved.data.reply, /gage pressure is 19\.60 kPa/);
  const challenge = await ask({ question: "Explain this result", context: { ...context, mode: "challenge", answerRevealed: false } });
  assert.equal(challenge.data.source, "rule_based");
  assert.match(challenge.data.reply, /keep the numerical answer hidden/);
  assert.doesNotMatch(challenge.data.reply, /19\.60/);
});

test("empty and malformed requests fail without an upstream call", async () => {
  const empty = await ask({ question: "  " });
  assert.equal(empty.response.status, 400);
  const malformed = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
});
