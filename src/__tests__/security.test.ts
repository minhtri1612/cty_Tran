import "./temp-db.js";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { productionServer, startServer } from "./helpers.js";

const { call, close } = await startServer();
const { prisma } = await import("../config/database.js");
after(close);

test("production setup sets a Secure, HttpOnly, SameSite=Strict cookie", async () => {
  const server = await productionServer({});
  try {
    const response = await server.post("/api/auth/setup", { username: "owner", password: "correct-horse-battery" });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie") || "";
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    const again = await server.post("/api/auth/setup", { username: "second", password: "correct-horse-battery" });
    assert.equal(again.status, 409);
  } finally {
    server.stop();
  }
});

test("behind one trusted proxy, login throttling is per client IP, not per proxy", async () => {
  const server = await productionServer({ TRUST_PROXY: "1" });
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const failed = await server.post("/api/auth/login", { username: "x", password: "y" }, { "X-Forwarded-For": "203.0.113.7" });
      assert.equal(failed.status, 401);
    }
    const blocked = await server.post("/api/auth/login", { username: "x", password: "y" }, { "X-Forwarded-For": "203.0.113.7" });
    assert.equal(blocked.status, 429);
    const other = await server.post("/api/auth/login", { username: "x", password: "y" }, { "X-Forwarded-For": "203.0.113.8" });
    assert.equal(other.status, 401);
  } finally {
    server.stop();
  }
});

let admin = "";

test("concurrent initial setups create exactly one admin", async () => {
  const results = await Promise.all(["a1", "a2", "a3"].map((username) =>
    call("/api/auth/setup", { method: "POST", body: { username: `owner-${username}`, password: "correct-horse-battery" } })));
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.equal(await prisma.user.count(), 1);
  admin = results.find((result) => result.status === 200)!.cookie;
});

test("only a hash of the session token is stored", async () => {
  const token = decodeURIComponent(admin.split("=")[1]);
  const sessions = await prisma.session.findMany();
  assert.ok(sessions.length >= 1);
  assert.ok(sessions.every((session) => session.tokenHash !== token && /^[0-9a-f]{64}$/.test(session.tokenHash)));
});

test("cross-site or malformed origins cannot change state", async () => {
  const state = await call("/api/state", { cookie: admin });
  const body = { data: state.json.data, version: state.json.version };
  for (const headers of [{ Origin: "https://evil.example" }, { Origin: "null" }, { "Sec-Fetch-Site": "cross-site" }]) {
    const response = await call("/api/state", { method: "PUT", cookie: admin, body, headers });
    assert.equal(response.status, 403, JSON.stringify(headers));
  }
  assert.equal((await call("/api/state", { cookie: admin })).json.version, state.json.version);
});

test("warehouse users cannot use admin endpoints", async () => {
  assert.equal((await call("/api/users", { method: "POST", cookie: admin, body: { username: "kho2", password: "warehouse-password-2", role: "warehouse" } })).status, 201);
  const login = await call("/api/auth/login", { method: "POST", body: { username: "kho2", password: "warehouse-password-2" } });
  assert.equal((await call("/api/users", { cookie: login.cookie })).status, 403);
  assert.equal((await call("/api/users", { method: "POST", cookie: login.cookie, body: { username: "kho3", password: "warehouse-password-3", role: "admin" } })).status, 403);
  assert.equal((await call("/api/users/kho2", { method: "DELETE", cookie: login.cookie })).status, 403);
});

test("changing a password ends the user's other sessions", async () => {
  const first = await call("/api/auth/login", { method: "POST", body: { username: "kho2", password: "warehouse-password-2" } });
  const second = await call("/api/auth/login", { method: "POST", body: { username: "kho2", password: "warehouse-password-2" } });
  const changed = await call("/api/auth/password", { method: "POST", cookie: first.cookie, body: { current_password: "warehouse-password-2", new_password: "warehouse-password-NEW" } });
  assert.equal(changed.status, 200);
  assert.equal((await call("/api/state", { cookie: second.cookie })).status, 401);
  assert.equal((await call("/api/state", { cookie: first.cookie })).status, 401);
  assert.equal((await call("/api/state", { cookie: changed.cookie })).status, 200);
});

test("deleting a user ends their sessions", async () => {
  const login = await call("/api/auth/login", { method: "POST", body: { username: "kho2", password: "warehouse-password-NEW" } });
  assert.equal((await call("/api/users/kho2", { method: "DELETE", cookie: admin })).status, 200);
  assert.equal((await call("/api/state", { cookie: login.cookie })).status, 401);
});

test("logout invalidates the session server-side", async () => {
  const login = await call("/api/auth/login", { method: "POST", body: { username: (await prisma.user.findFirst())!.username, password: "correct-horse-battery" } });
  assert.equal((await call("/api/auth/logout", { method: "POST", cookie: login.cookie, body: {} })).status, 200);
  assert.equal((await call("/api/state", { cookie: login.cookie })).status, 401);
});

test("errors are generic JSON without stack traces, and the server keeps running", async () => {
  await prisma.$executeRawUnsafe("ALTER TABLE app_meta RENAME TO app_meta_hidden");
  try {
    const failed = await call("/api/state", { cookie: admin });
    assert.equal(failed.status, 500);
    assert.deepEqual(Object.keys(failed.json), ["error"]);
    assert.doesNotMatch(JSON.stringify(failed.json), /at |prisma|app_meta|\.ts/i);
  } finally {
    await prisma.$executeRawUnsafe("ALTER TABLE app_meta_hidden RENAME TO app_meta");
  }
  assert.equal((await call("/api/state", { cookie: admin })).status, 200);
});

test("invalid JSON and unknown API paths return clean errors", async () => {
  const badJson = await call("/api/auth/login", { method: "POST", raw: "{not json" });
  assert.equal(badJson.status, 400);
  assert.match(badJson.json.error, /JSON/);
  const tooLarge = await call("/api/auth/login", { method: "POST", raw: JSON.stringify({ username: "x".repeat(17 * 1024 * 1024) }) });
  assert.equal(tooLarge.status, 413);
  const notFound = await call("/api/nope", { cookie: admin });
  assert.equal(notFound.status, 404);
  assert.ok(notFound.json.error);
});

test("security headers are set", async () => {
  const response = await call("/api/health");
  assert.match(response.headers.get("content-security-policy") || "", /script-src 'self'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});
