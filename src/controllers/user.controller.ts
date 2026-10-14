import type { Request, Response } from "express";
import { insertUser, isUniqueError, listUsers, removeUser } from "../services/auth.service.js";

export async function index(_request: Request, response: Response) {
  const users = await listUsers();
  response.json({ users: users.map((user) => ({ username: user.username, role: user.role, created_at: user.createdAt })) });
}

export async function create(request: Request, response: Response) {
  const username = String(request.body.username || "").trim().toLowerCase();
  const password = String(request.body.password || "");
  const role = String(request.body.role || "warehouse");
  if (!/^[a-z0-9._-]{3,60}$/.test(username) || password.length < 12 || password.length > 200 || !["admin", "warehouse"].includes(role)) {
    return response.status(400).json({ error: "Tên đăng nhập dùng 3–60 ký tự a–z, 0–9, dấu chấm, gạch dưới hoặc gạch ngang; mật khẩu cần ít nhất 12 ký tự và vai trò hợp lệ" });
  }
  try {
    await insertUser(username, password, role);
  } catch (error) {
    if (isUniqueError(error)) return response.status(409).json({ error: "Tên đăng nhập đã tồn tại" });
    throw error;
  }
  response.status(201).json({ ok: true });
}

export async function destroy(request: Request, response: Response) {
  const result = await removeUser(String(request.params.username || "").toLowerCase());
  if (result === "missing") return response.status(404).json({ error: "Không tìm thấy tài khoản" });
  if (result === "last-admin") return response.status(409).json({ error: "Không thể xóa tài khoản quản trị viên cuối cùng" });
  response.json({ ok: true });
}
