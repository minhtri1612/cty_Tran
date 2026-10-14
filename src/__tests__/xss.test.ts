import assert from "node:assert/strict";
import { test } from "node:test";
import { loadFrontend } from "./frontend.js";

const payloads = [`x');alert('xss');('`, `"><img src=x onerror=alert('xss')>`, `</script><script>alert('xss')</script>`];

function decode(value: string) {
  return value.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[name]);
}

function hostileState(evil: string) {
  return {
    materials: [["V-1", evil, evil, evil, 5, 1, 1000]],
    material_profiles: { "V-1": { supplier: evil, customer: evil, note: evil, spec: evil } },
    receipts: [["PNK-1", "13/10/2026", evil, 1, 5000]],
    issues: [["PXK-1", "14/10/2026", evil, "DH-1", evil, 0]],
    orders: [["DH-1", evil, "12/10/2026", evil, evil, "1", evil]],
    suppliers: [evil],
    supplier_categories: [evil],
    supplier_profiles: { [evil]: { categories: evil, note: evil, address: evil, phone: evil } },
    supplier_products: { [evil]: [{ id: "SP-1", name: evil, unit: evil, note: evil, price: 1 }] },
    doc_details: { "PNK-1": { note: evil, created_by: evil, history: [], lines: [{ code: "V-1", qty: 5, unit_price: 1000, supplier: evil }] } },
    order_details: { "DH-1": { unit: evil, extra_pct: 0, materials: [{ code: "V-1", qty: 1 }], note: evil } },
    customers: [evil],
    ledger: [["13/10/2026", "V-1", "Nhập", 5, "PNK-1"]],
    counts: [{ id: "KK-1", date: "14/10/2026", note: evil, created_by: evil, lines: [{ code: "V-1", before: 5, counted: 5, delta: 0 }] }],
  };
}

function assertInert(html: string, evil: string, where: string) {
  for (const [, handler] of html.matchAll(/\son\w+="([^"]*)"/g)) {
    assert.ok(!decode(handler).includes("xss"), `${where}: payload reached an inline handler: ${handler}`);
  }
  assert.ok(!/<img src=x|<script>alert/i.test(html), `${where}: payload rendered as markup`);
  for (const [, args] of html.matchAll(/data-args="([^"]*)"/g)) {
    const parsed = JSON.parse(decode(args));
    for (const value of parsed) if (typeof value === "string" && value.includes("xss")) assert.equal(value, evil, where);
  }
}

for (const evil of payloads) {
  test(`stored text is rendered as data, not code: ${evil}`, () => {
    const ui = loadFrontend();
    ui.data = hostileState(evil);
    const views: Record<string, string> = {
      dashboard: "viewDashboard()",
      materials: "viewMaterials()",
      count: "viewCount()",
      receipts: `viewDocs("receipts")`,
      issues: `viewDocs("issues")`,
      orders: "viewOrders()",
      ledger: "viewLedger()",
      suppliers: `viewContacts("suppliers")`,
      customers: `viewContacts("customers")`,
    };
    for (const [name, call] of Object.entries(views)) assertInert(ui.run(call), evil, name);
    const modals: Record<string, string> = {
      supplierCategories: "supplierCategoryModal()",
      materialDetail: `materialDetail("V-1")`,
      materialHistory: `materialDetail("V-1", "history")`,
      receipt: `showDocDetails("PNK-1", "receipts")`,
      order: `showOrderDetails("DH-1")`,
      count: `showCountDetails("KK-1")`,
      supplierEdit: `contactModal("suppliers", 0)`,
      customerEdit: `contactModal("customers", 0)`,
    };
    for (const [name, call] of Object.entries(modals)) {
      ui.run(`globalThis.__modal = ""; document.getElementById("modalRoot").innerHTML = "";`);
      ui.run(call);
      const html = (ui.modalHtml() || "") + ui.element("modalRoot").innerHTML + ui.element("modalBody").innerHTML + ui.element("modalFoot").innerHTML;
      assertInert(html, evil, name);
    }
  });
}

test("a supplier category action passes the exact name through data-args", () => {
  const ui = loadFrontend();
  const evil = payloads[0];
  ui.data = hostileState(evil);
  ui.run("supplierCategoryModal()");
  const html = ui.modalHtml() + ui.element("modalRoot").innerHTML;
  const match = html.match(/data-act="renameSupplierCategory" data-args="([^"]*)"/);
  assert.ok(match, "rename action rendered via data-act");
  assert.deepEqual(JSON.parse(decode(match[1])), [evil]);
});
