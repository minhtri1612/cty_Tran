import type { Request, Response } from "express";
import { buildReport } from "../services/report.service.js";

export async function download(_request: Request, response: Response) {
  const body = await buildReport();
  response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  response.setHeader("Content-Disposition", "attachment; filename=hoang-nhat-scm-report.xlsx");
  response.send(body);
}
