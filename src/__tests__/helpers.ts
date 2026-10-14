import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Server } from "node:http";

const root = resolve(import.meta.dirname, "../..");

// Points this test process at a fresh, migrated SQLite file. Must run before
// anything imports src/config/database.ts.
export function useTempDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "hn-scm-test-"));
  const path = join(dir, "test.sqlite3");
  process.env.SCM_DB_PATH = path;
  delete process.env.SETUP_TOKEN;
  migrate(path);
  return path;
}

export function migrate(path: string) {
  execFileSync(process.execPath, [resolve(root, "scripts/prisma.mjs"), "migrate", "deploy"], {
    env: { ...process.env, SCM_DB_PATH: path },
    stdio: "pipe",
  });
}

type CallOptions = { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> };

export async function startServer() {
  const { app } = await import("../app.js");
  const server = await new Promise<Server>((done) => {
    const started = app.listen(0, "127.0.0.1", () => done(started));
  });
  const port = (server.address() as { port: number }).port;
  async function call(path: string, { method = "GET", body, cookie, headers = {} }: CallOptions = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    return { status: response.status, json, cookie: (response.headers.get("set-cookie") || "").split(";")[0], headers: response.headers };
  }
  return { call, close: () => new Promise<void>((done) => server.close(() => done())) };
}
