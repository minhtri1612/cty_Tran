import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const root = resolve(import.meta.dirname, "../..");
if (!process.env.SCM_DB_PATH && existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));

export function databasePath() {
  return resolve(root, process.env.SCM_DB_PATH || "data/hoang-nhat.sqlite3");
}

// Under `node --test`, refuse anything but a temporary database so a test can
// never write to a developer's or a real database.
if (process.env.NODE_TEST_CONTEXT && !databasePath().startsWith(tmpdir())) {
  throw new Error(`Tests must use a temporary database (import ./temp-db.js first), not ${databasePath()}`);
}

// One connection: every write in this process is serialized through it, and the
// state transaction in state.service.ts takes SQLite's write lock first.
// socket_timeout is SQLite's busy timeout (seconds), e.g. while a backup runs.
export const prisma = new PrismaClient({
  datasources: { db: { url: `file:${databasePath()}?connection_limit=1&socket_timeout=20` } },
});

// Refuses to run against a missing or partially migrated database instead of
// letting the app create an empty file. Schema changes only happen through
// `npm run db:migrate`, never on startup.
const migrateHint = ' Khởi tạo/cập nhật schema: "npm run db:migrate" (Docker: docker compose run --rm app node scripts/prisma.mjs migrate deploy).';

export async function checkDatabase() {
  const path = databasePath();
  if (!existsSync(path)) {
    throw new Error(`Không tìm thấy database SQLite tại ${path}.${migrateHint}`);
  }
  const expected = readdirSync(resolve(root, "prisma/migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  let rows: { migration_name: string }[];
  try {
    rows = await prisma.$queryRawUnsafe(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
    );
  } catch {
    throw new Error(`Database ${path} chưa được khởi tạo bằng Prisma migrate.${migrateHint}`);
  }
  const applied = new Set(rows.map((row) => row.migration_name));
  const pending = expected.filter((name) => !applied.has(name));
  if (pending.length) throw new Error(`Database còn migration chưa áp dụng: ${pending.join(", ")}. Sao lưu trước.${migrateHint}`);
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  const [{ foreign_keys: foreignKeys }] = await prisma.$queryRawUnsafe<{ foreign_keys: bigint | number }[]>("PRAGMA foreign_keys");
  if (Number(foreignKeys) !== 1) throw new Error("SQLite foreign_keys đang tắt");
}
