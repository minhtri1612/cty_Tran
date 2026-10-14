import "./temp-db.js";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startServer } from "./helpers.js";

const { call, close } = await startServer();
const { prisma } = await import("../config/database.js");
const { saveState } = await import("../services/state.service.js");
after(close);

let admin = "";
let warehouse = "";

before(async () => {
  const setup = await call("/api/auth/setup", { method: "POST", body: { username: "owner", password: "correct-horse-battery" } });
  assert.equal(setup.status, 200);
  admin = setup.cookie;
  const created = await call("/api/users", { method: "POST", cookie: admin, body: { username: "kho1", password: "warehouse-password-1", role: "warehouse" } });
  assert.equal(created.status, 201);
  const login = await call("/api/auth/login", { method: "POST", body: { username: "kho1", password: "warehouse-password-1" } });
  assert.equal(login.status, 200);
  warehouse = login.cookie;
});

async function snapshot(cookie = admin) {
  const response = await call("/api/state", { cookie });
  assert.equal(response.status, 200);
  return response.json as { data: any; version: number };
}

function withMaterial(data: any, code: string, name: string) {
  return { ...data, materials: [...data.materials, [code, name, "Vải", "Mét", 0, 0, 0]] };
}

test("two concurrent saves of the same version: one wins, the other gets 409", async () => {
  const { data, version } = await snapshot();
  const [first, second] = await Promise.all([
    call("/api/state", { method: "PUT", cookie: admin, body: { data: withMaterial(data, "A-1", "Từ người A"), version } }),
    call("/api/state", { method: "PUT", cookie: admin, body: { data: withMaterial(data, "B-1", "Từ người B"), version } }),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const winner = first.status === 200 ? "A-1" : "B-1";
  const loser = first.status === 200 ? second : first;
  assert.equal(loser.json.version, version + 1);
  const after = await snapshot();
  assert.equal(after.version, version + 1);
  assert.deepEqual(after.data.materials.map((row) => row[0]), [winner]);
});

test("many concurrent saves of the same version: exactly one succeeds", async () => {
  const { data, version } = await snapshot();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      call("/api/state", { method: "PUT", cookie: admin, body: { data: withMaterial(data, `C-${index}`, `Lần ${index}`), version } })),
  );
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.equal(results.filter((result) => result.status === 409).length, 7);
  assert.equal((await snapshot()).version, version + 1);
});

test("version increments exactly once per successful save", async () => {
  let { data, version } = await snapshot();
  for (let index = 0; index < 3; index += 1) {
    data = withMaterial(data, `SEQ-${index}`, `Tuần tự ${index}`);
    const saved = await call("/api/state", { method: "PUT", cookie: admin, body: { data, version } });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.version, version + 1);
    version = saved.json.version;
  }
  assert.equal((await snapshot()).version, version);
});

test("a stale version is rejected without overwriting newer data", async () => {
  const { data, version } = await snapshot();
  const fresh = await call("/api/state", { method: "PUT", cookie: admin, body: { data: withMaterial(data, "NEW-1", "Mới"), version } });
  assert.equal(fresh.status, 200);
  const stale = await call("/api/state", { method: "PUT", cookie: admin, body: { data, version } });
  assert.equal(stale.status, 409);
  const after = await snapshot();
  assert.ok(after.data.materials.some((row) => row[0] === "NEW-1"));
});

test("a validation failure changes nothing", async () => {
  const before = await snapshot();
  const bad = { ...before.data, materials: [["bad code!", "x", "y", "z", -1, 0, 0]] };
  const response = await call("/api/state", { method: "PUT", cookie: admin, body: { data: bad, version: before.version } });
  assert.equal(response.status, 400);
  assert.deepEqual(await snapshot(), before);
});

test("a missing or non-integer version is a 400, not a save", async () => {
  const before = await snapshot();
  for (const version of [undefined, "0", 1.5, -1]) {
    const response = await call("/api/state", { method: "PUT", cookie: admin, body: { data: before.data, version } });
    assert.equal(response.status, 400);
  }
  assert.deepEqual(await snapshot(), before);
});

test("a database error mid-replacement rolls back everything, including the version", async () => {
  const before = await snapshot();
  // Duplicate primary keys fail inside createMany, after every table was emptied.
  const broken = { ...before.data, customers: ["Khách A", "Khách A"] };
  await assert.rejects(saveState(broken, before.version, "owner"));
  assert.deepEqual(await snapshot(), before);
  assert.ok(before.data.materials.length > 0);
});

test("a warehouse user cannot change suppliers; the rejected save leaves the version alone", async () => {
  const before = await snapshot(warehouse);
  const response = await call("/api/state", {
    method: "PUT",
    cookie: warehouse,
    body: { data: { ...before.data, suppliers: [...before.data.suppliers, "NCC lạ"] }, version: before.version },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await snapshot(warehouse), before);
});

test("a warehouse user cannot add materials or edit existing ones", async () => {
  const before = await snapshot(warehouse);
  const added = await call("/api/state", { method: "PUT", cookie: warehouse, body: { data: withMaterial(before.data, "W-1", "Kho thêm"), version: before.version } });
  assert.equal(added.status, 403);
  const renamed = structuredClone(before.data);
  renamed.materials[0][1] = "Đổi tên";
  const edited = await call("/api/state", { method: "PUT", cookie: warehouse, body: { data: renamed, version: before.version } });
  assert.equal(edited.status, 403);
  assert.deepEqual(await snapshot(warehouse), before);
});

test("a demoted user's role is checked inside the save transaction", async () => {
  const before = await snapshot();
  await prisma.user.update({ where: { username: "owner" }, data: { role: "warehouse" } });
  try {
    const response = await call("/api/state", { method: "PUT", cookie: admin, body: { data: { ...before.data, customers: ["Khách mới"] }, version: before.version } });
    assert.equal(response.status, 403);
  } finally {
    await prisma.user.update({ where: { username: "owner" }, data: { role: "admin" } });
  }
  assert.deepEqual(await snapshot(), before);
});

test("an admin can make administrative changes", async () => {
  const before = await snapshot();
  const data = { ...before.data, suppliers: ["NCC Hoàng Gia"], customers: ["Công ty May Việt"], supplier_categories: ["Vải"] };
  const response = await call("/api/state", { method: "PUT", cookie: admin, body: { data, version: before.version } });
  assert.equal(response.status, 200);
  const after = await snapshot();
  assert.deepEqual(after.data.suppliers, ["NCC Hoàng Gia"]);
  assert.deepEqual(after.data.customers, ["Công ty May Việt"]);
});

test("a warehouse receipt with matching ledger and stock is accepted", async () => {
  const before = await snapshot(warehouse);
  const data = structuredClone(before.data);
  const material = data.materials[0];
  material[4] += 5;
  material[6] = 2000;
  data.receipts.unshift(["PN-TEST-1", "14/10/2026", "NCC Hoàng Gia", 1, 10000]);
  data.doc_details["PN-TEST-1"] = { note: "", created_by: "kho1", lines: [{ code: material[0], qty: 5, unit_price: 2000, supplier: "NCC Hoàng Gia" }] };
  data.ledger.unshift(["14/10/2026", material[0], "Nhập", 5, "PN-TEST-1"]);
  const response = await call("/api/state", { method: "PUT", cookie: warehouse, body: { data, version: before.version } });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const after = await snapshot(warehouse);
  assert.equal(after.data.materials[0][4], before.data.materials[0][4] + 5);
  assert.equal(after.data.ledger.length, before.data.ledger.length + 1);
});
