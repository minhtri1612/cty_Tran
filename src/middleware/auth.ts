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

// CSRF defence for state-changing requests (on top of SameSite=Strict
// cookies): reject browser requests from another site. Requests without
// Origin/Sec-Fetch-Site (non-browser clients) still need a valid session.
// Behind Caddy the original Host header is passed through unchanged.
export function sameOrigin(request: Request, response: Response, next: NextFunction) {
  const reject = () => response.status(403).json({ error: "Yêu cầu không cùng nguồn" });
  const site = request.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return reject();
  const origin = request.headers.origin;
  if (!origin) return next();
  let host = "";
  try {
    host = new URL(origin).host;
  } catch {
    return reject();
  }
  if (!host || host !== request.headers.host) return reject();
  next();
}
