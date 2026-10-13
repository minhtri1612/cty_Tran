import { Router } from "express";
import { changePassword, login, logout, setup, status } from "../controllers/auth.controller.js";
import { download } from "../controllers/report.controller.js";
import { show, update } from "../controllers/state.controller.js";
import { create, destroy, index } from "../controllers/user.controller.js";
import { requireAdmin, requireUser, sameOrigin } from "../middleware/auth.js";

export const apiRouter = Router();

apiRouter.get("/health", (_request, response) => response.json({ ok: true, database: "sqlite" }));
apiRouter.get("/auth/status", status);
apiRouter.post("/auth/setup", sameOrigin, setup);
apiRouter.post("/auth/login", sameOrigin, login);
apiRouter.post("/auth/logout", sameOrigin, logout);
apiRouter.post("/auth/password", sameOrigin, requireUser, changePassword);
apiRouter.get("/users", requireAdmin, index);
apiRouter.post("/users", sameOrigin, requireAdmin, create);
apiRouter.delete("/users/:username", sameOrigin, requireAdmin, destroy);
apiRouter.get("/state", requireUser, show);
apiRouter.put("/state", sameOrigin, requireUser, update);
apiRouter.get("/report.xlsx", requireUser, download);
