import { execFileSync, spawn } from "node:child_process";
import assert from "node:assert/strict";
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

type CallOptions = { method?: string; body?: unknown; raw?: string; cookie?: string; headers?: Record<string, string> };

export async function startServer() {
  const { app } = await import("../app.js");
  const server = await new Promise<Server>((done) => {
    const started = app.listen(0, "127.0.0.1", () => done(started));
  });
  const port = (server.address() as { port: number }).port;
  async function call(path: string, { method = "GET", body, raw, cookie, headers = {} }: CallOptions = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await response.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    return { status: response.status, json, cookie: (response.headers.get("set-cookie") || "").split(";")[0], headers: response.headers, url: response.url };
  }
  return { call, close: () => new Promise<void>((done) => server.close(() => done())) };
}

// Starts the real server entry point in a child process with its own env and
// database, for settings that are read once at startup (NODE_ENV, proxies).
export async function productionServer(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "hn-scm-prod-"));
  const path = join(dir, "prod.sqlite3");
  migrate(path);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["--import", "tsx", resolve(root, "src/server.ts")], {
    env: { ...process.env, NODE_ENV: "production", SCM_DB_PATH: path, SCM_PORT: String(port), PORT: "", SCM_HOST: "127.0.0.1", SETUP_TOKEN: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 100 && !output.includes("listening"); attempt += 1) await new Promise((done) => setTimeout(done, 100));
  assert.ok(output.includes("listening"), output);
  const base = `http://127.0.0.1:${port}`;
  return {
    post: (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }),
    get: (path: string) => fetch(base + path),
    stop: () => child.kill(),
    exited: () => new Promise<number | null>((done) => child.once("exit", (code) => done(code))),
    child,
  };
}

