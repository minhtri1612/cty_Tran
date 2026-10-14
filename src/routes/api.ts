import { type NextFunction, type Request, type RequestHandler, type Response, Router } from "express";
import { changePassword, login, logout, setup, status } from "../controllers/auth.controller.js";
import { download } from "../controllers/report.controller.js";
import { show, update } from "../controllers/state.controller.js";
import { create, destroy, index } from "../controllers/user.controller.js";
import { prisma } from "../config/database.js";
import { requireAdmin, requireUser, sameOrigin } from "../middleware/auth.js";

// Express 4 does not catch rejected promises; forward them to the error handler
// instead of crashing the process with an unhandled rejection.
function safe(handler: (request: Request, response: Response, next: NextFunction) => unknown): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

export const apiRouter = Router();

apiRouter.get("/health", safe(async (_request, response) => {
  await prisma.$queryRawUnsafe("SELECT 1");
  response.json({ ok: true, database: "sqlite" });
}));
apiRouter.get("/auth/status", safe(status));
apiRouter.post("/auth/setup", sameOrigin, safe(setup));
apiRouter.post("/auth/login", sameOrigin, safe(login));
apiRouter.post("/auth/logout", sameOrigin, safe(logout));
apiRouter.post("/auth/password", sameOrigin, safe(requireUser), safe(changePassword));
apiRouter.get("/users", safe(requireAdmin), safe(index));
apiRouter.post("/users", sameOrigin, safe(requireAdmin), safe(create));
apiRouter.delete("/users/:username", sameOrigin, safe(requireAdmin), safe(destroy));
apiRouter.get("/state", safe(requireUser), safe(show));
apiRouter.put("/state", sameOrigin, safe(requireUser), safe(update));
apiRouter.get("/report.xlsx", safe(requireUser), safe(download));
