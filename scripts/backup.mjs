// Consistent SQLite backups for Hoàng Nhật SCM.
//
//   node scripts/backup.mjs create <outDir>     -> <outDir>/hoang-nhat-<UTC>.sqlite3.gz (+ .sha256)
//   node scripts/backup.mjs verify <file.gz>    -> checks sha256, gunzips to a temp file, runs integrity_check
//   node scripts/backup.mjs extract <file.gz> <dest.sqlite3>  -> verify, then write the plain database file
//
// "create" uses VACUUM INTO, which copies the database inside one read
// transaction: the snapshot is consistent even while the app is writing (WAL
// mode), unlike copying the file. Never copy a live .sqlite3 file directly.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { DatabaseSync } from "node:sqlite";

const root = resolve(import.meta.dirname, "..");
if (!process.env.SCM_DB_PATH && existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));
const source = resolve(root, process.env.SCM_DB_PATH || "data/hoang-nhat.sqlite3");

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function check(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const result = db.prepare("PRAGMA integrity_check").all().map((row) => row.integrity_check);
    if (result.length !== 1 || result[0] !== "ok") throw new Error(`integrity_check failed: ${result.join("; ")}`);
    const version = db.prepare("SELECT value FROM app_meta WHERE key = 'version'").get()?.value;
    const migrations = db.prepare("SELECT COUNT(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL").get().n;
    const materials = db.prepare("SELECT COUNT(*) AS n FROM materials").get().n;
    const ledger = db.prepare("SELECT COUNT(*) AS n FROM ledger").get().n;
    return { version, migrations, materials, ledger };
  } finally {
    db.close();
  }
}

async function create(outDir) {
  if (!existsSync(source)) throw new Error(`Database not found: ${source}`);
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const name = `hoang-nhat-${stamp}.sqlite3`;
  const work = mkdtempSync(join(outDir, ".tmp-"));
  try {
    const snapshot = join(work, name);
    const db = new DatabaseSync(source, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout = 20000");
      db.prepare("VACUUM INTO ?").run(snapshot);
    } finally {
      db.close();
    }
    const stats = check(snapshot);
    const gz = join(work, `${name}.gz`);
    await pipeline(createReadStream(snapshot), createGzip({ level: 9 }), createWriteStream(gz));
    const digest = sha256(gz);
    writeFileSync(`${gz}.sha256`, `${digest}  ${name}.gz\n`);
    renameSync(`${gz}.sha256`, join(outDir, `${name}.gz.sha256`));
    renameSync(gz, join(outDir, `${name}.gz`));
    console.log(JSON.stringify({ backup: join(outDir, `${name}.gz`), sha256: digest, ...stats }));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function extract(file, dest) {
  const sumFile = `${file}.sha256`;
  if (!existsSync(sumFile)) throw new Error(`Missing checksum file ${sumFile}`);
  const expected = readFileSync(sumFile, "utf8").split(/\s+/)[0];
  if (sha256(file) !== expected) throw new Error("sha256 mismatch: backup is corrupt or incomplete");
  const work = mkdtempSync(join(dest ? dirname(resolve(dest)) : tmpdir(), ".restore-"));
  try {
    const plain = join(work, basename(file).replace(/\.gz$/, ""));
    await pipeline(createReadStream(file), createGunzip(), createWriteStream(plain));
    const stats = check(plain);
    if (dest) {
      if (existsSync(dest)) throw new Error(`Refusing to overwrite existing ${dest}`);
      renameSync(plain, dest);
    }
    console.log(JSON.stringify({ verified: file, ...stats, ...(dest ? { restoredTo: dest } : {}) }));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const [command, a, b] = process.argv.slice(2);
try {
  if (command === "create" && a) await create(resolve(a));
  else if (command === "verify" && a) await extract(resolve(a), null);
  else if (command === "extract" && a && b) await extract(resolve(a), resolve(b));
  else {
    console.error("Usage: backup.mjs create <outDir> | verify <file.gz> | extract <file.gz> <dest.sqlite3>");
    process.exit(2);
  }
} catch (error) {
  console.error(`Backup error: ${error.message}`);
  process.exit(1);
}
