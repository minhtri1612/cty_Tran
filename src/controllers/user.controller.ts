import type { Request, Response } from "express";
import { insertUser, listUsers, removeUser } from "../services/auth.service.js";

export function index(_request: Request, response: Response) {
  response.json({ users: listUsers() });
}

export function create(request: Request, response: Response) {
  const username = String(request.body.username || "").trim().toLowerCase();
  const password = String(request.body.password || "");
  const role = String(request.body.role || "warehouse");
  if (!/^[a-z0-9._-]{3,60}$/.test(username) || password.length < 12 || password.length > 200 || !["admin", "warehouse"].includes(role)) {
    return response.status(400).json({ error: "Tên đăng nhập dùng 3–60 ký tự a–z, 0–9, dấu chấm, gạch dưới hoặc gạch ngang; mật khẩu cần ít nhất 12 ký tự và vai trò hợp lệ" });
  }
  try {
    insertUser(username, password, role);
  } catch (error) {
    if (String((error as Error).message).includes("UNIQUE")) return response.status(409).json({ error: "Tên đăng nhập đã tồn tại" });
    throw error;
  }
  response.status(201).json({ ok: true });
}

export function destroy(request: Request, response: Response) {
  const result = removeUser(String(request.params.username || "").toLowerCase());
  if (result === "missing") return response.status(404).json({ error: "Không tìm thấy tài khoản" });
  if (result === "last-admin") return response.status(409).json({ error: "Không thể xóa tài khoản quản trị viên cuối cùng" });
  response.json({ ok: true });
}
