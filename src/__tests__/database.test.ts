import { dbPath } from "./temp-db.js";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { migrate } from "./helpers.js";

const path = dbPath;
const { prisma, checkDatabase } = await import("../config/database.js");

test("migrate deploy creates the schema and seeds version 0", async () => {
  await checkDatabase();
  const row = await prisma.appMeta.findUnique({ where: { key: "version" } });
  assert.equal(row?.value, "0");
  const [{ journal_mode: mode }] = await prisma.$queryRawUnsafe<{ journal_mode: string }[]>("PRAGMA journal_mode");
  assert.equal(mode, "wal");
});

test("foreign keys are enforced (deleting a user removes its sessions)", async () => {
  await prisma.user.create({ data: { username: "u1", passwordSalt: Buffer.alloc(16), passwordHash: Buffer.alloc(32), createdAt: 1, role: "admin" } });
  await prisma.session.create({ data: { tokenHash: "h", username: "u1", expiresAt: 2_000_000_000 } });
  await prisma.user.delete({ where: { username: "u1" } });
  assert.equal(await prisma.session.count(), 0);
  await assert.rejects(prisma.session.create({ data: { tokenHash: "h2", username: "nobody", expiresAt: 1 } }));
});

test("re-running migrate deploy keeps existing data", async () => {
  await prisma.material.create({ data: { code: "KEEP-1", name: "Chỉ may", category: "Phụ liệu", unit: "Cuộn" } });
  await prisma.$disconnect();
  const size = statSync(path).size;
  migrate(path);
  assert.ok(statSync(path).size >= size);
  const kept = await prisma.material.findUnique({ where: { code: "KEEP-1" } });
  assert.equal(kept?.name, "Chỉ may");
});

test("checkDatabase refuses a missing database file without creating it", async () => {
  const missing = join(path, "..", "missing.sqlite3");
  const { execFileSync } = await import("node:child_process");
  const script = `process.env.SCM_DB_PATH=${JSON.stringify(missing)};const m=await import(${JSON.stringify(new URL("../config/database.ts", import.meta.url).href)});try{await m.checkDatabase();console.log("ok")}catch(e){console.log("refused")}`;
  const out = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { encoding: "utf8" }).trim();
  assert.equal(out, "refused");
  assert.equal(existsSync(missing), false);
});
