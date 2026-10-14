// Runs the Prisma CLI against the SQLite file named by SCM_DB_PATH, so the CLI
// and the app (src/config/database.ts) always resolve the same absolute path.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
if (!process.env.SCM_DB_PATH && existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));

const path = resolve(root, process.env.SCM_DB_PATH || "data/hoang-nhat.sqlite3");
const args = process.argv.slice(2);
const allowed = ["migrate deploy", "migrate status", "migrate diff", "generate", "validate", "format", "--version"];
if (!allowed.some((prefix) => args.join(" ").startsWith(prefix))) {
  console.error(`Lệnh không được phép qua script này: prisma ${args.join(" ")}`);
  console.error("Chỉ cho phép: " + allowed.join(", ") + ". Không dùng db push / migrate reset trên database thật.");
  process.exit(2);
}
mkdirSync(dirname(path), { recursive: true });
console.error(`SQLite database: ${path}`);
const bin = resolve(root, "node_modules/.bin/prisma");
const result = spawnSync(bin, args, { stdio: "inherit", env: { ...process.env, DATABASE_URL: `file:${path}` } });
process.exit(result.status ?? 1);
