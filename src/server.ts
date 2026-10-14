import { app } from "./app.js";
import { checkDatabase, databasePath } from "./config/database.js";

const port = Number(process.env.PORT || process.env.SCM_PORT || 4173);
const host = process.env.SCM_HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");

try {
  await checkDatabase();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

app.listen(port, host, () => {
  console.log(`SCM listening on http://${host}:${port}`);
  console.log(`SQLite database: ${databasePath()}`);
});
