import express from "express";
import { resolve } from "node:path";
import { apiRouter } from "./routes/api.js";

const root = resolve(import.meta.dirname, "..");

export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "6mb" }));
app.use("/static", express.static(resolve(root, "static")));
app.get(["/", "/index.html"], (_request, response) => {
  response.sendFile(resolve(root, "index.html"));
});
app.use("/api", apiRouter);
