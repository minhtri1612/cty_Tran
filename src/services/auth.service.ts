import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { cookieName, pbkdf2Rounds, sessionSeconds } from "../config/constant.js";
import { db, get, run } from "../config/database.js";

const loginFailures = new Map<string, number[]>();

export function passwordHash(password: string, salt: Buffer) {
  return pbkdf2Sync(password, salt, pbkdf2Rounds, 32, "sha256");
}

export function sameSecret(left: Buffer | Uint8Array, right: Buffer | Uint8Array) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function readSessionToken(header: string | undefined) {
  const pair = String(header || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  return pair ? decodeURIComponent(pair.slice(cookieName.length + 1)) : "";
}

export function currentUser(cookieHeader: string | undefined) {
  const token = readSessionToken(cookieHeader);
  if (!token) return null;
  const row = get(db, "SELECT username, expires_at FROM sessions WHERE token_hash=?", tokenHash(token)) as { username: string; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    run(db, "DELETE FROM sessions WHERE token_hash=?", tokenHash(token));
    return null;
  }
  return row.username;
}

export function roleOf(username: string) {
  const row = get(db, "SELECT role FROM users WHERE username=?", username) as { role: string } | undefined;
  return row?.role || null;
}

export function startSession(username: string) {
  const token = randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  run(db, "DELETE FROM sessions WHERE expires_at < ?", now);
  run(db, "INSERT INTO sessions VALUES(?,?,?)", tokenHash(token), username, now + sessionSeconds);
  return token;
}

export function endSession(cookieHeader: string | undefined) {
  const token = readSessionToken(cookieHeader);
  if (token) run(db, "DELETE FROM sessions WHERE token_hash=?", tokenHash(token));
}

export function tooManyLogins(remote: string) {
  const now = Math.floor(Date.now() / 1000);
  const recent = (loginFailures.get(remote) || []).filter((stamp) => now - stamp < 900);
  loginFailures.set(remote, recent);
  return recent.length >= 10;
}

export function noteFailedLogin(remote: string) {
  const now = Math.floor(Date.now() / 1000);
  const recent = loginFailures.get(remote) || [];
  recent.push(now);
  loginFailures.set(remote, recent);
}

export function clearFailedLogins(remote: string) {
  loginFailures.delete(remote);
}

export function findUser(username: string) {
  return get(db, "SELECT username,password_salt,password_hash,role FROM users WHERE username=?", username) as { username: string; password_salt: Uint8Array; password_hash: Uint8Array; role: string } | undefined;
}

export function userExists() {
  return Boolean(get(db, "SELECT 1 AS ok FROM users LIMIT 1"));
}

export function insertUser(username: string, password: string, role: string) {
  const salt = randomBytes(16);
  run(db, "INSERT INTO users(username,password_salt,password_hash,created_at,role) VALUES(?,?,?,?,?)", username, salt, passwordHash(password, salt), Math.floor(Date.now() / 1000), role);
}

export function listUsers() {
  return db.prepare("SELECT username,role,created_at FROM users ORDER BY username").all() as { username: string; role: string; created_at: number }[];
}

export function updatePassword(username: string, password: string) {
  const salt = randomBytes(16);
  run(db, "UPDATE users SET password_salt=?,password_hash=? WHERE username=?", salt, passwordHash(password, salt), username);
  run(db, "DELETE FROM sessions WHERE username=?", username);
}

export function removeUser(username: string) {
  const target = get(db, "SELECT role FROM users WHERE username=?", username) as { role: string } | undefined;
  if (!target) return "missing" as const;
  const admins = get(db, "SELECT COUNT(*) AS n FROM users WHERE role='admin'") as { n: number };
  if (target.role === "admin" && admins.n <= 1) return "last-admin" as const;
  run(db, "DELETE FROM users WHERE username=?", username);
  return "ok" as const;
}

export function begin() {
  db.exec("BEGIN IMMEDIATE");
}

export function commit() {
  db.exec("COMMIT");
}

export function rollback() {
  db.exec("ROLLBACK");
}
