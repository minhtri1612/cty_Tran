import { dbPath } from "./temp-db.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { productionServer, startServer, pw } from "./helpers.js";

const { call, close } = await startServer();
after(close);
const script = resolve(import.meta.dirname, "../../scripts/backup.mjs");
const outDir = mkdtempSync(join(tmpdir(), "hn-scm-backups-"));

function backup(...args: string[]) {
  return JSON.parse(execFileSync(process.execPath, ["--no-warnings", script, ...args], { env: { ...process.env, SCM_DB_PATH: dbPath }, encoding: "utf8" }).trim());
}

function fails(...args: string[]) {
  try {
    execFileSync(process.execPath, ["--no-warnings", script, ...args], { env: { ...process.env, SCM_DB_PATH: dbPath }, stdio: "pipe" });
    return "";
  } catch (error: any) {
    return String(error.stderr);
  }
}

let admin = "";
let archive = "";
let backedUpVersion = 0;

test("a backup taken during concurrent saves is a consistent, committed state", async () => {
  admin = (await call("/api/auth/setup", { method: "POST", body: { username: "owner", password: pw("admin") } })).cookie;
  let stop = false;
  const writer = (async () => {
    let saves = 0;
    while (!stop) {
      const { data, version } = (await call("/api/state", { cookie: admin })).json;
      const code = `B-${saves}`;
      data.materials.push([code, `Vải ${saves}`, "Vải", "Mét", 1, 0, 0]);
      data.ledger.unshift(["14/10/2026", code, "Kiểm kê", 1, "Tồn ban đầu"]);
      const saved = await call("/api/state", { method: "PUT", cookie: admin, body: { data, version } });
      assert.equal(saved.status, 200);
      saves += 1;
    }
    return saves;
  })();
  await new Promise((done) => setTimeout(done, 300));
  const result = backup("create", outDir);
  stop = true;
  const saves = await writer;
  assert.ok(saves > 1, `writer made ${saves} saves`);
  archive = result.backup;
  backedUpVersion = Number(result.version);
  assert.ok(backedUpVersion >= 1 && backedUpVersion <= saves);
  // Each committed save adds exactly one material and one ledger row.
  assert.equal(result.materials, backedUpVersion);
  assert.equal(result.ledger, backedUpVersion);
  assert.equal(result.migrations, 1);
});

test("verify checks the checksum and integrity", () => {
  assert.equal(backup("verify", archive).version, String(backedUpVersion));
  const corrupt = join(outDir, "corrupt.sqlite3.gz");
  const bytes = readFileSync(archive);
  bytes[bytes.length - 10] ^= 0xff;
  writeFileSync(corrupt, bytes);
  writeFileSync(`${corrupt}.sha256`, readFileSync(`${archive}.sha256`));
  assert.match(fails("verify", corrupt), /sha256 mismatch/);
  assert.match(fails("verify", join(outDir, "missing.sqlite3.gz")), /Missing checksum/);
});

test("extract refuses to overwrite an existing database", () => {
  assert.match(fails("extract", archive, dbPath), /Refusing to overwrite/);
});

test("a restored backup opens in the app with the backed-up data", async () => {
  const restored = join(mkdtempSync(join(tmpdir(), "hn-scm-restore-")), "restored.sqlite3");
  backup("extract", archive, restored);
  assert.ok(existsSync(restored));
  assert.equal(readdirSync(outDir).filter((name) => name.startsWith(".tmp-")).length, 0);
  const server = await productionServer({ SCM_DB_PATH: restored });
  try {
    const login = await server.post("/api/auth/login", { username: "owner", password: pw("admin") });
    assert.equal(login.status, 200);
  } finally {
    server.stop();
  }
});
