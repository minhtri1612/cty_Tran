import assert from "node:assert/strict";
import { after, test } from "node:test";
import { startServer, useTempDatabase } from "./helpers.js";

useTempDatabase();
const { call, close } = await startServer();
after(close);

test("setup then save a material", async () => {
  const setup = await call("/api/auth/setup", { method: "POST", body: { username: "owner", password: "correct-horse-battery" } });
  assert.equal(setup.status, 200);
  const cookie = setup.cookie;
  const first = await call("/api/state", { cookie });
  assert.equal(first.json.version, 0);
  first.json.data.materials = [["TEST-1", "Vải kaki", "Vải", "Mét", 10, 2, 1500]];
  const saved = await call("/api/state", { method: "PUT", cookie, body: { data: first.json.data, version: 0 } });
  assert.equal(saved.status, 200);
  const again = await call("/api/state", { cookie });
  assert.equal(again.json.data.materials[0][1], "Vải kaki");
  assert.equal(again.json.version, 1);
});
