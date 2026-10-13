import type { Request, Response } from "express";
import { begin, commit, roleOf, rollback } from "../services/auth.service.js";
import { readState, stateVersion, warehouseChangeError, writeState } from "../services/state.service.js";
import { validateState } from "../validation/state.schema.js";
import { run, db } from "../config/database.js";

export function show(_request: Request, response: Response) {
  const username = response.locals.username as string;
  response.json({ data: readState(db), username, role: roleOf(username), version: stateVersion(db) });
}

export function update(request: Request, response: Response) {
  const error = validateState(request.body.data);
  if (error) return response.status(400).json({ error });
  begin();
  const username = response.locals.username as string;
  const current = stateVersion(db);
  if (request.body.version !== current) {
    rollback();
    return response.status(409).json({ error: "Dữ liệu vừa được người khác cập nhật. Hãy tải lại trang trước khi lưu.", version: current });
  }
  if (roleOf(username) !== "admin") {
    const blocked = warehouseChangeError(db, request.body.data);
    if (blocked) {
      rollback();
      return response.status(403).json({ error: blocked });
    }
  }
  writeState(db, request.body.data);
  run(db, "UPDATE app_meta SET value=? WHERE key='version'", String(current + 1));
  commit();
  response.json({ ok: true, version: current + 1 });
}
