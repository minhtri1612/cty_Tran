import type { Request, Response } from "express";
import { cookieName, sessionSeconds } from "../config/constant.js";
import { clearFailedLogins, currentUser, endSession, findUser, insertUser, isUniqueError, noteFailedLogin, passwordHash, roleOf, sameSecret, startSession, tooManyLogins, updatePassword, userExists } from "../services/auth.service.js";

function setSession(response: Response, token: string) {
  response.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: sessionSeconds * 1000,
    secure: process.env.COOKIE_SECURE === "true",
  });
}

export async function status(request: Request, response: Response) {
  const username = await currentUser(request.headers.cookie);
  response.json({
    configured: await userExists(),
    authenticated: Boolean(username),
    username,
    role: username ? await roleOf(username) : null,
    setup_requires_token: Boolean(process.env.SETUP_TOKEN),
  });
}

export async function setup(request: Request, response: Response) {
  if (await userExists()) return response.status(409).json({ error: "Tài khoản quản trị đã được thiết lập" });
  const setupToken = process.env.SETUP_TOKEN || "";
  if (setupToken && !sameSecret(Buffer.from(String(request.body.setup_token || "")), Buffer.from(setupToken))) {
    return response.status(403).json({ error: "Mã thiết lập không đúng" });
  }
  const username = String(request.body.username || "").trim().toLowerCase();
  const password = String(request.body.password || "");
  if (!/^[a-z0-9._-]{3,60}$/.test(username) || password.length < 12 || password.length > 200) {
    return response.status(400).json({ error: "Tên đăng nhập dùng 3–60 ký tự a–z, 0–9, dấu chấm, gạch dưới hoặc gạch ngang; mật khẩu cần ít nhất 12 ký tự" });
  }
  try {
    await insertUser(username, password, "admin");
  } catch (error) {
    if (isUniqueError(error)) return response.status(409).json({ error: "Tài khoản quản trị đã được thiết lập" });
    throw error;
  }
  setSession(response, await startSession(username));
  response.json({ ok: true, username });
}

export async function login(request: Request, response: Response) {
  const remote = request.ip || "";
  if (tooManyLogins(remote)) return response.status(429).json({ error: "Thử đăng nhập quá nhiều lần. Chờ 15 phút rồi thử lại." });
  const username = String(request.body.username || "").trim().toLowerCase();
  const password = String(request.body.password || "");
  const row = await findUser(username);
  if (!row || !sameSecret(passwordHash(password, Buffer.from(row.passwordSalt)), row.passwordHash)) {
    noteFailedLogin(remote);
    return response.status(401).json({ error: "Tên đăng nhập hoặc mật khẩu không đúng" });
  }
  clearFailedLogins(remote);
  setSession(response, await startSession(row.username));
  response.json({ ok: true, username: row.username, role: row.role });
}

export async function logout(request: Request, response: Response) {
  await endSession(request.headers.cookie);
  response.clearCookie(cookieName, { path: "/" });
  response.json({ ok: true });
}

export async function changePassword(request: Request, response: Response) {
  const username = response.locals.username as string;
  const row = await findUser(username);
  if (!row || !sameSecret(passwordHash(String(request.body.current_password || ""), Buffer.from(row.passwordSalt)), row.passwordHash)) {
    return response.status(400).json({ error: "Mật khẩu hiện tại không đúng" });
  }
  const next = String(request.body.new_password || "");
  if (next.length < 12 || next.length > 200) return response.status(400).json({ error: "Mật khẩu mới cần ít nhất 12 ký tự" });
  await updatePassword(username, next);
  setSession(response, await startSession(username));
  response.json({ ok: true });
}
