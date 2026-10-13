import { resolve } from "node:path";
import { app } from "./app.js";
import { databasePath } from "./config/database.js";

const port = Number(process.env.PORT || process.env.SCM_PORT || 4173);
const host = process.env.SCM_HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");

app.listen(port, host, () => {
  console.log(`SCM listening on http://${host}:${port}`);
  console.log(`SQLite database: ${databasePath()}`);
});
