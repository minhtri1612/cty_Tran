import express, { type NextFunction, type Request, type Response } from "express";
import { resolve } from "node:path";
import { apiRouter } from "./routes/api.js";

const root = resolve(import.meta.dirname, "..");

// Content-Security-Policy: scripts only from this origin. 'unsafe-inline' is
// still needed for the remaining constant inline handlers (onclick="go('x')");
// stored data never reaches those (see act() in static/js/utils.js).
// connect-src allows https: because a material photo can be fetched by URL.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

export const app = express();
app.disable("x-powered-by");
// Number of reverse proxies in front of the app (1 = Caddy). Only then is
// X-Forwarded-For trusted for request.ip (login throttling) and protocol.
const proxies = Number(process.env.TRUST_PROXY || 0);
if (proxies > 0) app.set("trust proxy", proxies);
app.use((_request, response, next) => {
  response.setHeader("Content-Security-Policy", csp);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "same-origin");
  next();
});
app.use("/api", (_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: process.env.SCM_BODY_LIMIT || "6mb" }));
app.use("/static", express.static(resolve(root, "static")));
app.get(["/", "/index.html"], (_request, response) => {
  response.sendFile(resolve(root, "index.html"));
});
app.use("/api", apiRouter);
app.use("/api", (_request, response) => {
  response.status(404).json({ error: "Không tìm thấy API" });
});

// Last-resort error handler: body-parser errors get specific messages; anything
// else is logged server-side and answered with a generic message (no stack,
// no internal details).
app.use((error: any, request: Request, response: Response, _next: NextFunction) => {
  if (error?.type === "entity.too.large") return response.status(413).json({ error: "Dữ liệu gửi lên quá lớn" });
  if (error?.type === "entity.parse.failed") return response.status(400).json({ error: "Dữ liệu gửi lên không đúng định dạng JSON" });
  console.error(`${request.method} ${request.originalUrl} failed:`, error instanceof Error ? error.stack : error);
  if (response.headersSent) return;
  response.status(500).json({ error: "Lỗi máy chủ. Vui lòng thử lại." });
});
