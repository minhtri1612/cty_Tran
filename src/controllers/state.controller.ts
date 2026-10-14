import type { Request, Response } from "express";
import { roleOf } from "../services/auth.service.js";
import { readSnapshot, SaveForbiddenError, saveState, StaleVersionError } from "../services/state.service.js";
import { validateState } from "../validation/state.schema.js";

export async function show(_request: Request, response: Response) {
  const username = response.locals.username as string;
  const { data, version } = await readSnapshot();
  response.json({ data, username, role: await roleOf(username), version });
}

export async function update(request: Request, response: Response) {
  const expected = request.body?.version;
  if (!Number.isSafeInteger(expected) || expected < 0) return response.status(400).json({ error: "Thiếu phiên bản dữ liệu hợp lệ" });
  const error = validateState(request.body.data);
  if (error) return response.status(400).json({ error });
  try {
    const version = await saveState(request.body.data, expected, response.locals.username as string);
    response.json({ ok: true, version });
  } catch (failure) {
    if (failure instanceof StaleVersionError) {
      return response.status(409).json({ error: "Dữ liệu vừa được người khác cập nhật. Hãy tải lại trang trước khi lưu.", version: failure.current });
    }
    if (failure instanceof SaveForbiddenError) return response.status(403).json({ error: failure.message });
    console.error("PUT /api/state failed:", failure instanceof Error ? failure.message : failure);
    response.status(500).json({ error: "Không lưu được dữ liệu. Thay đổi chưa được ghi." });
  }
}
