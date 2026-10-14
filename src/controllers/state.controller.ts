import type { Request, Response } from "express";
import { roleOf } from "../services/auth.service.js";
import { readState, replaceState, stateVersion, warehouseChangeError } from "../services/state.service.js";
import { validateState } from "../validation/state.schema.js";

export async function show(_request: Request, response: Response) {
  const username = response.locals.username as string;
  response.json({ data: await readState(), username, role: await roleOf(username), version: await stateVersion() });
}

export async function update(request: Request, response: Response) {
  const error = validateState(request.body.data);
  if (error) return response.status(400).json({ error });
  const username = response.locals.username as string;
  const current = await stateVersion();
  if (request.body.version !== current) {
    return response.status(409).json({ error: "Dữ liệu vừa được người khác cập nhật. Hãy tải lại trang trước khi lưu.", version: current });
  }
  if (await roleOf(username) !== "admin") {
    const blocked = await warehouseChangeError(request.body.data);
    if (blocked) return response.status(403).json({ error: blocked });
  }
  try {
    const version = await replaceState(request.body.data);
    response.json({ ok: true, version });
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: "Không lưu được dữ liệu" });
  }
}
