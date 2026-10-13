import type { Request, Response } from "express";
import { db } from "../config/database.js";
import { buildReport } from "../services/report.service.js";

export function download(_request: Request, response: Response) {
  const body = buildReport(db);
  response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  response.setHeader("Content-Disposition", "attachment; filename=hoang-nhat-scm-report.xlsx");
  response.send(body);
}
