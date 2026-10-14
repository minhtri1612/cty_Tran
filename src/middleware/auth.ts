import type { NextFunction, Request, Response } from "express";
import { currentUser, roleOf } from "../services/auth.service.js";

export async function requireUser(request: Request, response: Response, next: NextFunction) {
  const username = await currentUser(request.headers.cookie);
  if (!username) return response.status(401).json({ error: "Vui lòng đăng nhập lại" });
  response.locals.username = username;
  response.locals.role = await roleOf(username);
  next();
}

export async function requireAdmin(request: Request, response: Response, next: NextFunction) {
  const username = await currentUser(request.headers.cookie);
  if (!username) return response.status(401).json({ error: "Vui lòng đăng nhập lại" });
  const role = await roleOf(username);
  if (role !== "admin") return response.status(403).json({ error: "Chỉ quản trị viên mới được quản lý tài khoản" });
  response.locals.username = username;
  response.locals.role = role;
  next();
}

export function sameOrigin(request: Request, response: Response, next: NextFunction) {
  if (!request.headers.origin) return next();
  const host = new URL(request.headers.origin).host;
  if (host !== request.headers.host) return response.status(403).json({ error: "Yêu cầu không cùng nguồn" });
  next();
}
