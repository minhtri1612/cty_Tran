import "./temp-db.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateState } from "../services/state.service.js";
import { loadFrontend } from "./frontend.js";

function base() {
  return {
    materials: [["V-1", "Vải kaki", "Vải", "Mét", 10, 2, 1500], ["C-1", "Chỉ", "Phụ liệu", "Cuộn", 0, 0, 0]],
    material_profiles: { "V-1": { supplier: "NCC A", customer: "Khách X" } },
    receipts: [["PNK-1", "13/10/2026", "NCC A, NCC B", 2, 15000]],
    issues: [["PXK-1", "14/10/2026", "Khách X", "DH-1", "Cấp phát sản xuất", 1]],
    orders: [["DH-1", "Khách X", "12/10/2026", "Áo sơ mi", "100", "1", "Đang thực hiện"]],
    suppliers: ["NCC A", "NCC B"],
    supplier_categories: [],
    supplier_profiles: {},
    supplier_products: {},
    doc_details: {
      "PNK-1": { note: "", created_by: "owner", history: [], lines: [
        { code: "V-1", qty: 6, unit_price: 1500, supplier: "NCC A" },
        { code: "V-1", qty: 6, unit_price: 1000, supplier: "NCC B" }] },
      "PXK-1": { note: "", created_by: "owner", history: [], lines: [{ code: "V-1", qty: 2, unit_price: 0, supplier: "" }] },
    },
    order_details: {},
    customers: ["Khách X"],
    ledger: [
      ["14/10/2026", "V-1", "Xuất", -2, "PXK-1"],
      ["13/10/2026", "V-1", "Nhập", 6, "PNK-1"],
      ["13/10/2026", "V-1", "Nhập", 6, "PNK-1"],
    ],
    counts: [],
  };
}

test("the baseline fixture is valid", () => {
  assert.equal(validateState(base()), null);
});

test("stock that does not match the ledger is rejected", () => {
  const data = base();
  data.materials[0][4] = 11;
  assert.match(validateState(data), /không khớp với tổng giao dịch/);
});

test("ledger rows for unknown materials are rejected", () => {
  const data = base();
  data.ledger.push(["14/10/2026", "GHOST", "Kiểm kê", 0, "Sửa hồ sơ"]);
  assert.match(validateState(data), /không tồn tại: GHOST/);
});

test("duplicate contacts and document ids are a validation error, not a database error", () => {
  assert.match(validateState({ ...base(), customers: ["Khách X", "Khách X"] }), /trùng/);
  const sameId = base();
  sameId.issues[0][0] = "PNK-1";
  sameId.ledger[0][4] = "PNK-1";
  delete sameId.doc_details["PXK-1"];
  assert.match(validateState(sameId), /trùng/);
});

test("document and order ids must be safe identifiers", () => {
  for (const id of ["x');alert(1)//", "<img src=x>", "", "a".repeat(121)]) {
    const data = base();
    data.receipts[0][0] = id;
    data.doc_details[id] = data.doc_details["PNK-1"];
    delete data.doc_details["PNK-1"];
    assert.match(validateState(data), /Mã phiếu/, id);
    const order = base();
    order.orders[0][0] = id;
    assert.ok(validateState(order), id);
  }
});

test("an issue must reference an existing order or '—'", () => {
  const data = base();
  data.issues[0][3] = "DH-MISSING";
  assert.match(validateState(data), /đơn hàng không tồn tại/);
  data.issues[0][3] = "—";
  assert.equal(validateState(data), null);
});

test("non-integer line counts are rejected before they reach the database", () => {
  const data = base();
  data.receipts[0][3] = 2.5;
  assert.ok(validateState(data));
});

test("long but reasonable text is accepted; oversized text is rejected", () => {
  const data = base();
  data.materials[0][1] = "Vải ".repeat(50);
  data.doc_details["PNK-1"].note = "ghi chú ".repeat(250);
  assert.equal(validateState(data), null);
  data.materials[0][1] = "x".repeat(201);
  assert.match(validateState(data), /Tên NVL/);
});

test("CSV import records ledger adjustments, so the result passes server validation", async () => {
  const ui = loadFrontend();
  ui.data = base();
  const csv = "﻿Mã NVL,Tên nguyên vật liệu,Nhóm,ĐVT,Tồn thực tế,Tồn tối thiểu,Giá gần nhất\nV-1,Vải kaki,Vải,Mét,25,2,1500\nN-1,Nút áo,Phụ liệu,Cái,40,0,200\nN-2,Khóa kéo,Phụ liệu,Cái,0,0,0\n";
  await ui.run(`importMaterialsCSV({ files: [{ text: async () => ${JSON.stringify(csv)} }], value: "" })`);
  const data = ui.data;
  assert.equal(validateState(data), null, ui.toasts.join(" | "));
  assert.deepEqual(data.ledger.find((row) => row[1] === "N-1").slice(1), ["N-1", "Kiểm kê", 40, "Tồn ban đầu"]);
  assert.deepEqual(data.ledger.find((row) => row[1] === "V-1" && row[4] === "Sửa hồ sơ").slice(1, 4), ["V-1", "Kiểm kê", 15]);
  assert.equal(data.ledger.filter((row) => row[1] === "N-2").length, 0);
});

test("renaming a customer updates material profiles too", async () => {
  const ui = loadFrontend();
  ui.data = base();
  ui.run(`contactModal("customers", 0)`);
  ui.element("contactName").value = "Khách X mới";
  await ui.save();
  const data = ui.data;
  assert.equal(data.material_profiles["V-1"].customer, "Khách X mới");
  assert.equal(data.orders[0][1], "Khách X mới");
  assert.equal(validateState(data), null);
});

test("renaming a supplier updates multi-supplier receipts and material profiles", async () => {
  const ui = loadFrontend();
  ui.data = base();
  ui.run(`contactModal("suppliers", 1)`);
  ui.element("contactName").value = "NCC B mới";
  await ui.save();
  const data = ui.data;
  assert.equal(data.receipts[0][2], "NCC A, NCC B mới");
  assert.equal(data.doc_details["PNK-1"].lines[1].supplier, "NCC B mới");
  assert.equal(validateState(data), null);
  ui.run(`contactModal("suppliers", 0)`);
  ui.element("contactName").value = "NCC A2";
  await ui.save();
  assert.equal(ui.data.material_profiles["V-1"].supplier, "NCC A2");
  assert.equal(validateState(ui.data), null);
});

test("deleting a contact that is still referenced is refused with a clear reason", async () => {
  const ui = loadFrontend();
  const data = base();
  data.suppliers.push("NCC C");
  data.material_profiles["C-1"] = { supplier: "NCC C" };
  ui.data = data;
  await ui.run(`removeContact("suppliers", 1)`);
  assert.ok(ui.data.suppliers.includes("NCC B"));
  assert.match(ui.toasts.at(-1), /phiếu/);
  await ui.run(`removeContact("suppliers", 2)`);
  assert.ok(ui.data.suppliers.includes("NCC C"));
  assert.match(ui.toasts.at(-1), /hồ sơ nguyên vật liệu/);
});

test("an admin deleting an issue reverses stock and ledger consistently", async () => {
  const ui = loadFrontend();
  ui.data = base();
  await ui.run(`removeDoc("PXK-1", "issues")`);
  const data = ui.data;
  assert.equal(data.materials[0][4], 12);
  assert.equal(data.ledger.some((row) => row[4] === "PXK-1"), false);
  assert.equal(data.orders[0][5], "0");
  assert.equal(validateState(data), null, ui.toasts.join(" | "));
});

test("an admin deleting a receipt whose stock was already issued is refused", async () => {
  const ui = loadFrontend();
  const data = base();
  data.materials[0][4] = 0;
  data.ledger.unshift(["15/10/2026", "V-1", "Kiểm kê", -10, "KK-1"]);
  ui.data = data;
  await ui.run(`removeDoc("PNK-1", "receipts")`);
  assert.ok(ui.data.receipts.some((row) => row[0] === "PNK-1"));
  assert.match(ui.toasts.at(-1), /tồn kho sẽ bị âm/);
});
