import "./temp-db.js";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { after, before, test } from "node:test";
import { validateState } from "../services/state.service.js";
import { loadFrontend } from "./frontend.js";
import { startServer } from "./helpers.js";

const { call, close } = await startServer();
after(close);

let admin = "";
let warehouse = "";

async function snapshot(cookie = admin) {
  return (await call("/api/state", { cookie })).json as { data: any; version: number };
}

async function put(cookie: string, data: any, version: number) {
  return call("/api/state", { method: "PUT", cookie, body: { data, version } });
}

before(async () => {
  admin = (await call("/api/auth/setup", { method: "POST", body: { username: "owner", password: "correct-horse-battery" } })).cookie;
  assert.equal((await call("/api/users", { method: "POST", cookie: admin, body: { username: "kho", password: "warehouse-password", role: "warehouse" } })).status, 201);
  warehouse = (await call("/api/auth/login", { method: "POST", body: { username: "kho", password: "warehouse-password" } })).cookie;
  const { data, version } = await snapshot();
  Object.assign(data, {
    materials: [["V-1", "Vải kaki", "Vải", "Mét", 100, 10, 1500], ["N-1", "Nút áo", "Phụ liệu", "Cái", 50, 0, 200]],
    suppliers: ["NCC A"],
    customers: ["Khách X"],
    orders: [["DH-1", "Khách X", "12/10/2026", "Áo sơ mi", "100", "0", "Đang thực hiện"]],
    order_details: { "DH-1": { unit: "Cái", extra_pct: 10, materials: [{ code: "V-1", qty: 20 }], note: "" } },
    ledger: [["10/10/2026", "N-1", "Kiểm kê", 50, "Tồn ban đầu"], ["10/10/2026", "V-1", "Kiểm kê", 100, "Tồn ban đầu"]],
  });
  assert.equal((await put(admin, data, version)).status, 200);
});

// Builds the same rows the issue form (docs.js saveDoc) produces.
function addIssue(data: any, id: string, order: string, lines: [string, number][]) {
  data.issues.unshift([id, "14/10/2026", "Khách X", order, "Xuất sản xuất", lines.length]);
  data.doc_details[id] = { note: "", created_by: "kho", history: [], lines: lines.map(([code, qty]) => ({ code, qty, unit_price: 0, supplier: "" })) };
  for (const [code, qty] of lines) {
    data.ledger.unshift(["14/10/2026", code, "Xuất", -qty, id]);
    data.materials.find((row) => row[0] === code)[4] -= qty;
  }
  const linked = data.orders.find((row) => row[0] === order);
  if (linked) linked[5] = String(Number(linked[5]) + 1);
}

test("a warehouse issue within the order allowance (plan + 10%) is saved", async () => {
  const { data, version } = await snapshot(warehouse);
  addIssue(data, "PXK-1", "DH-1", [["V-1", 22]]);
  const response = await put(warehouse, data, version);
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const after = await snapshot();
  assert.equal(after.data.materials.find((row) => row[0] === "V-1")[4], 78);
  assert.equal(after.data.orders[0][5], "1");
});

test("issuing beyond the order allowance is rejected", async () => {
  const { data, version } = await snapshot(warehouse);
  addIssue(data, "PXK-2", "DH-1", [["V-1", 0.5]]);
  const response = await put(warehouse, data, version);
  assert.equal(response.status, 400);
  assert.match(response.json.error, /vượt định mức/i);
});

test("issuing a material the order has no plan for is rejected", async () => {
  const { data } = await snapshot(warehouse);
  addIssue(data, "PXK-3", "DH-1", [["N-1", 1]]);
  assert.match(validateState(data), /chưa khai báo định mức/);
});

test("a warehouse user can change an order's status but not its contract fields", async () => {
  let { data, version } = await snapshot(warehouse);
  data.orders[0][6] = "Hoàn thành";
  const toggled = await put(warehouse, data, version);
  assert.equal(toggled.status, 200, JSON.stringify(toggled.json));
  ({ data, version } = await snapshot(warehouse));
  data.orders[0][3] = "Áo khoác";
  assert.equal((await put(warehouse, data, version)).status, 403);
  ({ data, version } = await snapshot(warehouse));
  data.orders[0][5] = "5";
  assert.equal((await put(warehouse, data, version)).status, 403);
});

test("the frontend allowance check agrees with the server", () => {
  const ui = loadFrontend();
  ui.data = validStateAfterFirstIssue();
  assert.equal(ui.run(`issueExceedsOrderAllowance("DH-1", [{ code: "V-1", qty: 0 }])`), "");
  assert.match(ui.run(`issueExceedsOrderAllowance("DH-1", [{ code: "V-1", qty: 0.5 }])`), /Vượt định mức/);
});

function validStateAfterFirstIssue() {
  return {
    materials: [["V-1", "Vải kaki", "Vải", "Mét", 78, 10, 1500]],
    receipts: [], counts: [], suppliers: [], customers: ["Khách X"], supplier_categories: [], supplier_profiles: {}, supplier_products: {}, material_profiles: {},
    issues: [["PXK-1", "14/10/2026", "Khách X", "DH-1", "Xuất sản xuất", 1]],
    orders: [["DH-1", "Khách X", "12/10/2026", "Áo sơ mi", "100", "1", "Đang thực hiện"]],
    order_details: { "DH-1": { extra_pct: 10, materials: [{ code: "V-1", qty: 20 }] } },
    doc_details: { "PXK-1": { lines: [{ code: "V-1", qty: 22, unit_price: 0, supplier: "" }] } },
    ledger: [["14/10/2026", "V-1", "Xuất", -22, "PXK-1"], ["10/10/2026", "V-1", "Kiểm kê", 100, "Tồn ban đầu"]],
  };
}

test("a warehouse inventory count adjusts stock through the ledger", async () => {
  const { data, version } = await snapshot(warehouse);
  const material = data.materials.find((row) => row[0] === "N-1");
  data.counts.unshift({ id: "KK-1", date: "14/10/2026", note: "Kiểm cuối tuần", created_by: "kho", lines: [{ code: "N-1", before: 50, counted: 47, delta: -3 }] });
  data.ledger.unshift(["14/10/2026", "N-1", "Kiểm kê", -3, "KK-1"]);
  material[4] = 47;
  const response = await put(warehouse, data, version);
  assert.equal(response.status, 200, JSON.stringify(response.json));
});

test("a count whose ledger rows do not match its lines is refused", async () => {
  const { data, version } = await snapshot(warehouse);
  const material = data.materials.find((row) => row[0] === "N-1");
  data.counts.unshift({ id: "KK-2", date: "14/10/2026", note: "", created_by: "kho", lines: [{ code: "N-1", before: 47, counted: 40, delta: -7 }] });
  data.ledger.unshift(["14/10/2026", "N-1", "Kiểm kê", -6, "KK-2"]);
  material[4] = 41;
  assert.equal((await put(warehouse, data, version)).status, 403);
});

test("an admin can edit a saved receipt; ledger rows are replaced and history kept", async () => {
  let { data, version } = await snapshot();
  data.receipts.unshift(["PNK-1", "13/10/2026", "NCC A", 1, 20000]);
  data.doc_details["PNK-1"] = { note: "", created_by: "owner", history: [], lines: [{ code: "N-1", qty: 100, unit_price: 200, supplier: "NCC A" }] };
  data.ledger.unshift(["13/10/2026", "N-1", "Nhập", 100, "PNK-1"]);
  data.materials.find((row) => row[0] === "N-1")[4] += 100;
  let response = await put(admin, data, version);
  assert.equal(response.status, 200, JSON.stringify(response.json));
  ({ data, version } = await snapshot());
  const detail = data.doc_details["PNK-1"];
  detail.history.unshift({ at: new Date().toISOString(), by: "owner", action: "Sửa phiếu", date: "13/10/2026", party: "NCC A", kind: "Nhập", note: "", lines: detail.lines });
  detail.lines = [{ code: "N-1", qty: 80, unit_price: 200, supplier: "NCC A" }];
  data.ledger = data.ledger.filter((row) => row[4] !== "PNK-1");
  data.ledger.unshift(["13/10/2026", "N-1", "Nhập", 80, "PNK-1"]);
  data.materials.find((row) => row[0] === "N-1")[4] -= 20;
  data.receipts[0] = ["PNK-1", "13/10/2026", "NCC A", 1, 16000];
  response = await put(admin, data, version);
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const after = await snapshot();
  assert.equal(after.data.doc_details["PNK-1"].history.length, 1);
  assert.equal(after.data.ledger.filter((row) => row[4] === "PNK-1").length, 1);
});

test("a warehouse user cannot edit a saved receipt", async () => {
  const { data, version } = await snapshot(warehouse);
  data.doc_details["PNK-1"].note = "sửa lén";
  assert.equal((await put(warehouse, data, version)).status, 403);
});

test("images must be small JPEG/PNG/WebP data URIs", () => {
  const base = { ...validStateAfterFirstIssue() };
  for (const photo of ["data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)", "https://example.com/a.png", "data:image/png;base64," + "A".repeat(43_700)]) {
    assert.match(validateState({ ...base, material_profiles: { "V-1": { photo } } }), /Ảnh/, photo.slice(0, 30));
  }
  assert.equal(validateState({ ...base, material_profiles: { "V-1": { photo: "data:image/webp;base64,UklGRg==" } } }), null);
});

test("malformed payloads are rejected with 400", async () => {
  const { version } = await snapshot();
  for (const data of [null, [], { materials: "x" }, { materials: [], receipts: [], issues: [], orders: [], suppliers: [], customers: [] }]) {
    assert.equal((await put(admin, data, version)).status, 400, JSON.stringify(data));
  }
});

// Reads one stored (uncompressed) or deflated entry from the generated .xlsx.
function zipEntry(zip: Buffer, name: string) {
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8);
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extra = zip.readUInt16LE(offset + 28);
    const entry = zip.subarray(offset + 30, offset + 30 + nameLength).toString();
    const body = zip.subarray(offset + 30 + nameLength + extra, offset + 30 + nameLength + extra + size);
    if (entry === name) return (method === 8 ? inflateRawSync(body) : body).toString("utf8");
    offset += 30 + nameLength + extra + size;
  }
  return null;
}

test("the Excel report is a valid workbook with the four sheets and current data", async () => {
  const response = await fetch(await reportUrl(), { headers: { Cookie: admin } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /spreadsheetml/);
  const zip = Buffer.from(await response.arrayBuffer());
  assert.equal(zip.subarray(0, 2).toString(), "PK");
  const workbook = zipEntry(zip, "xl/workbook.xml");
  for (const sheet of ["Nguyên vật liệu", "Phiếu nhập", "Phiếu xuất", "Sổ kho"]) assert.ok(workbook?.includes(sheet), sheet);
  assert.ok(zipEntry(zip, "xl/worksheets/sheet1.xml")?.includes("Vải kaki"));
  assert.ok(zipEntry(zip, "xl/worksheets/sheet3.xml")?.includes("PXK-1"));
  assert.equal((await fetch(await reportUrl())).status, 401);
});

async function reportUrl() {
  const health = await call("/api/health");
  return new URL("/api/report.xlsx", health.url ?? "http://127.0.0.1").href;
}
