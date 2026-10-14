import "./temp-db.js";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { validateState } from "../services/state.service.js";
import { loadFrontend } from "./frontend.js";
import { productionServer, startServer, pw } from "./helpers.js";

const { call, close } = await startServer();
after(close);

let admin = "";
before(async () => {
  const setup = await call("/api/auth/setup", { method: "POST", body: { username: "owner", password: pw("admin") } });
  assert.equal(setup.status, 200);
  admin = setup.cookie;
});

async function save(mutate: (data: any) => void) {
  const current = (await call("/api/state", { cookie: admin })).json;
  mutate(current.data);
  return call("/api/state", { method: "PUT", cookie: admin, body: { data: current.data, version: current.version } });
}

function emptyState() {
  return { materials: [], receipts: [], issues: [], orders: [], suppliers: [], customers: [], ledger: [], counts: [], doc_details: {}, order_details: {}, material_profiles: {}, supplier_profiles: {}, supplier_products: {}, supplier_categories: [] };
}

test("documents are listed newest first by real date, not by DD/MM/YYYY text", async () => {
  const saved = await save((data) => {
    data.materials = [["V-1", "Vải", "Vải", "Mét", 3, 0, 0]];
    data.suppliers = ["NCC"];
    for (const [id, date] of [["PNK-A", "02/03/2025"], ["PNK-B", "31/01/2026"], ["PNK-C", "15/10/2026"]]) {
      data.receipts.push([id, date, "NCC", 1, 0]);
      data.doc_details[id] = { note: "", created_by: "owner", history: [], lines: [{ code: "V-1", qty: 1, unit_price: 0, supplier: "NCC" }] };
      data.ledger.push([date, "V-1", "Nhập", 1, id]);
    }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const state = (await call("/api/state", { cookie: admin })).json.data;
  assert.deepEqual(state.receipts.map((row) => row[1]), ["15/10/2026", "31/01/2026", "02/03/2025"]);
});

test("impossible or wrongly formatted dates are rejected", () => {
  for (const date of ["32/01/2026", "29/02/2025", "2026-10-14", "1/2/2026"]) {
    const data = { ...emptyState(), materials: [["V-1", "Vải", "Vải", "Mét", 1, 0, 0]], ledger: [[date, "V-1", "Kiểm kê", 1, "Tồn ban đầu"]] };
    assert.match(validateState(data), /DD\/MM\/YYYY/, date);
  }
  const leap = { ...emptyState(), materials: [["V-1", "Vải", "Vải", "Mét", 1, 0, 0]], ledger: [["29/02/2028", "V-1", "Kiểm kê", 1, "Tồn ban đầu"]] };
  assert.equal(validateState(leap), null);
});

test("the document list shows the stored creator, not the person viewing", () => {
  const ui = loadFrontend();
  ui.data = {
    ...emptyState(),
    materials: [["V-1", "Vải", "Vải", "Mét", 1, 0, 0]],
    receipts: [["PNK-1", "13/10/2026", "NCC", 1, 0], ["PNK-2", "12/10/2026", "NCC", 1, 0]],
    doc_details: { "PNK-1": { created_by: "nguoi-lap-1", lines: [] } },
  };
  ui.run(`currentUser = "nguoi-xem"`);
  const html = ui.run(`viewDocs("receipts")`);
  assert.match(html, /nguoi-lap-1/);
  assert.doesNotMatch(html, /nguoi-xem/);
  assert.match(html, /<td>—<\/td>/);
});

test("a save carrying the full 8 MB image allowance fits the request limit", async () => {
  const photo = "data:image/jpeg;base64," + "A".repeat(43_600);
  const response = await save((data) => {
    data.materials = Array.from({ length: 180 }, (_, index) => [`IMG-${index}`, "Ảnh", "Vải", "Cái", 0, 0, 0]);
    data.material_profiles = Object.fromEntries(data.materials.map((row) => [row[0], { photo }]));
    data.ledger = [];
    data.receipts = [];
    data.doc_details = {};
  });
  assert.equal(response.status, 200, JSON.stringify(response.json));
});

test("requests over the body limit get 413 and change nothing", async () => {
  const before = (await call("/api/state", { cookie: admin })).json.version;
  const response = await call("/api/state", { method: "PUT", cookie: admin, raw: JSON.stringify({ data: { materials: [], pad: "x".repeat(17 * 1024 * 1024) }, version: before }) });
  assert.equal(response.status, 413);
  assert.equal((await call("/api/state", { cookie: admin })).json.version, before);
});

test("the ledger can grow past the old 20,000-row cap", async () => {
  const response = await save((data) => {
    data.materials = [["L-1", "Chỉ", "Phụ liệu", "Cuộn", 25_000, 0, 0]];
    data.material_profiles = {};
    data.ledger = Array.from({ length: 25_000 }, () => ["14/10/2026", "L-1", "Kiểm kê", 1, "Sửa hồ sơ"]);
  });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal((await call("/api/state", { cookie: admin })).json.data.ledger.length, 25_000);
});

test("health check queries the database", async () => {
  const health = await call("/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(health.json, { ok: true, database: "sqlite" });
});

test("SIGTERM shuts the server down cleanly", async () => {
  const server = await productionServer({});
  assert.equal((await server.get("/api/health")).status, 200);
  const exited = server.exited();
  server.child.kill("SIGTERM");
  assert.equal(await exited, 0);
});
