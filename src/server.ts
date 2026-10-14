import { app } from "./app.js";

const port = Number(process.env.PORT || process.env.SCM_PORT || 4173);
const host = process.env.SCM_HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");

app.listen(port, host, () => {
  console.log(`SCM listening on http://${host}:${port}`);
  console.log("MySQL database: hoang_nhat");
});
