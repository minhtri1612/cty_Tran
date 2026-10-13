import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.SCM_DB_PATH = join(mkdtempSync(join(tmpdir(), "scm-")), "test.sqlite3");
delete process.env.SETUP_TOKEN;

const { app } = await import("../app.js");

async function call(path: string, { method = "GET", body, cookie }: { method?: string; body?: unknown; cookie?: string } = {}) {
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  const port = (server.address() as { port: number }).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : {}, cookie: response.headers.get("set-cookie") || "" };
  } finally {
    server.close();
  }
}

test("setup then save a material", async () => {
  const setup = await call("/api/auth/setup", { method: "POST", body: { username: "owner", password: "correct-horse-battery" } });
  assert.equal(setup.status, 200);
  const cookie = setup.cookie.split(";")[0];
  const first = await call("/api/state", { cookie });
  assert.equal(first.json.version, 0);
  first.json.data.materials = [["TEST-1", "Vai kaki", "Vải", "Mét", 10, 2, 1500]];
  const saved = await call("/api/state", { method: "PUT", cookie, body: { data: first.json.data, version: 0 } });
  assert.equal(saved.status, 200);
  const again = await call("/api/state", { cookie });
  assert.equal(again.json.data.materials[0][1], "Vai kaki");
});
