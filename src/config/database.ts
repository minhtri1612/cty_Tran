import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = resolve(import.meta.dirname, "../..");

export function databasePath() {
  return process.env.SCM_DB_PATH || resolve(root, "data/scm.sqlite3");
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_salt BLOB NOT NULL,
  password_hash BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin'
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS materials (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  minimum REAL NOT NULL DEFAULT 0 CHECK(minimum >= 0),
  price REAL NOT NULL DEFAULT 0 CHECK(price >= 0)
);
CREATE TABLE IF NOT EXISTS material_profiles (
  code TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, party TEXT NOT NULL,
  line_count INTEGER NOT NULL, total REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, party TEXT NOT NULL,
  order_id TEXT NOT NULL, kind TEXT NOT NULL, line_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, customer TEXT NOT NULL, signed_date TEXT NOT NULL,
  product TEXT NOT NULL, quantity TEXT NOT NULL, issue_count TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS suppliers (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS supplier_categories (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS supplier_profiles (
  name TEXT PRIMARY KEY REFERENCES suppliers(name) ON DELETE CASCADE,
  profile_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS supplier_products (
  supplier TEXT PRIMARY KEY, products_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS document_details (
  id TEXT PRIMARY KEY, detail_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_details (
  id TEXT PRIMARY KEY, detail_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL,
  material_code TEXT NOT NULL, kind TEXT NOT NULL,
  quantity REAL NOT NULL, reference TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory_counts (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, note TEXT NOT NULL,
  created_by TEXT NOT NULL, lines_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS ledger_material_date ON ledger(material_code, date);
`;

export function openDatabase() {
  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 20000");
  db.exec(schema);
  db.prepare("INSERT INTO app_meta(key,value) VALUES('version','0') ON CONFLICT(key) DO NOTHING").run();
  return db;
}

export function all(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}

export function get(db, sql, ...params) {
  return db.prepare(sql).get(...params);
}

export function run(db, sql, ...params) {
  return db.prepare(sql).run(...params);
}

export const db = openDatabase();
