import { app } from "./app.js";
import { checkDatabase, databasePath, prisma } from "./config/database.js";

const port = Number(process.env.PORT || process.env.SCM_PORT || 4173);
const host = process.env.SCM_HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");

try {
  await checkDatabase();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const server = app.listen(port, host, () => {
  console.log(`SCM listening on http://${host}:${port}`);
  console.log(`SQLite database: ${databasePath()}`);
});

// docker stop sends SIGTERM: stop accepting requests, let in-flight saves
// finish (or roll back), then close the database cleanly.
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 25_000);
  force.unref();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error instanceof Error ? error.stack : error);
});
