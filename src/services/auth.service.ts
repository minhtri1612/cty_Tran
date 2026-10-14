import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { cookieName, pbkdf2Rounds, sessionSeconds } from "../config/constant.js";
import { prisma } from "../config/database.js";

const loginFailures = new Map<string, number[]>();

export function passwordHash(password: string, salt: Buffer) {
  return pbkdf2Sync(password, salt, pbkdf2Rounds, 32, "sha256");
}

export function sameSecret(left: Buffer | Uint8Array, right: Buffer | Uint8Array) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Unknown usernames still pay for one PBKDF2 run, so response time does not
// reveal which usernames exist.
const dummySalt = randomBytes(16);
const dummyHash = passwordHash(randomBytes(16).toString("hex"), dummySalt);

export function checkPassword(row: { passwordSalt: Uint8Array; passwordHash: Uint8Array } | null, password: string) {
  const matches = sameSecret(passwordHash(password, Buffer.from(row ? row.passwordSalt : dummySalt)), row ? row.passwordHash : dummyHash);
  return Boolean(row) && matches;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function readSessionToken(header: string | undefined) {
  const pair = String(header || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  return pair ? decodeURIComponent(pair.slice(cookieName.length + 1)) : "";
}

export async function currentUser(cookieHeader: string | undefined) {
  const token = readSessionToken(cookieHeader);
  if (!token) return null;
  const row = await prisma.session.findUnique({ where: { tokenHash: tokenHash(token) } });
  if (!row) return null;
  if (row.expiresAt < Math.floor(Date.now() / 1000)) {
    await prisma.session.delete({ where: { tokenHash: row.tokenHash } });
    return null;
  }
  return row.username;
}

export async function roleOf(username: string) {
  const row = await prisma.user.findUnique({ where: { username } });
  return row?.role || null;
}

export async function startSession(username: string) {
  const token = randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.session.create({ data: { tokenHash: tokenHash(token), username, expiresAt: now + sessionSeconds } });
  return token;
}

export async function endSession(cookieHeader: string | undefined) {
  const token = readSessionToken(cookieHeader);
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
}

export function tooManyLogins(remote: string) {
  const now = Math.floor(Date.now() / 1000);
  const recent = (loginFailures.get(remote) || []).filter((stamp) => now - stamp < 900);
  loginFailures.set(remote, recent);
  return recent.length >= 10;
}

export function noteFailedLogin(remote: string) {
  if (loginFailures.size > 10_000) loginFailures.clear();
  const recent = loginFailures.get(remote) || [];
  recent.push(Math.floor(Date.now() / 1000));
  loginFailures.set(remote, recent);
}

export function clearFailedLogins(remote: string) {
  loginFailures.delete(remote);
}

export function findUser(username: string) {
  return prisma.user.findUnique({ where: { username } });
}

export async function userExists() {
  const row = await prisma.user.findFirst({ select: { username: true } });
  return Boolean(row);
}

// Creates the first admin only if no user exists yet, in one transaction, so
// two concurrent setup requests cannot both create an admin.
export function createFirstAdmin(username: string, password: string) {
  const salt = randomBytes(16);
  const hash = passwordHash(password, salt);
  return prisma.$transaction(async (tx) => {
    if (await tx.user.findFirst({ select: { username: true } })) return false;
    await tx.user.create({ data: { username, passwordSalt: salt, passwordHash: hash, createdAt: Math.floor(Date.now() / 1000), role: "admin" } });
    return true;
  });
}

export async function insertUser(username: string, password: string, role: string) {
  const salt = randomBytes(16);
  await prisma.user.create({
    data: { username, passwordSalt: salt, passwordHash: passwordHash(password, salt), createdAt: Math.floor(Date.now() / 1000), role },
  });
}

export function listUsers() {
  return prisma.user.findMany({ orderBy: { username: "asc" }, select: { username: true, role: true, createdAt: true } });
}

export async function updatePassword(username: string, password: string) {
  const salt = randomBytes(16);
  const hash = passwordHash(password, salt);
  await prisma.$transaction([
    prisma.user.update({ where: { username }, data: { passwordSalt: salt, passwordHash: hash } }),
    prisma.session.deleteMany({ where: { username } }),
  ]);
}

export function removeUser(username: string) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { username } });
    if (!target) return "missing" as const;
    const admins = await tx.user.count({ where: { role: "admin" } });
    if (target.role === "admin" && admins <= 1) return "last-admin" as const;
    await tx.user.delete({ where: { username } });
    return "ok" as const;
  });
}

export function isUniqueError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
