import type { Prisma } from "@prisma/client";
import { prisma } from "../config/database.js";

type Db = Prisma.TransactionClient;

export class StaleVersionError extends Error {
  constructor(readonly current: number) {
    super("stale version");
  }
}

export class SaveForbiddenError extends Error {}


const imagePattern = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function isNum(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function close(left, right, abs = 1e-6, rel = 1e-9) {
  return Math.abs(left - right) <= Math.max(abs, rel * Math.max(Math.abs(left), Math.abs(right)));
}

function sameCount(left, right) {
  const keys = new Set([...left.keys(), ...right.keys()]);
  for (const key of keys) {
    if ((left.get(key) || 0) !== (right.get(key) || 0)) return false;
  }
  return true;
}

function addCount(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

export async function readState(db: Db = prisma) {
  const [materials, materialProfiles, receipts, issues, orders, suppliers, supplierCategories, supplierProfiles, supplierProducts, docDetails, orderDetails, customers, ledger, counts] = await Promise.all([
    db.material.findMany({ orderBy: { code: "asc" } }),
    db.materialProfile.findMany(),
    db.receipt.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }] }),
    db.issue.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }] }),
    db.order.findMany({ orderBy: [{ signedDate: "desc" }, { id: "desc" }] }),
    db.supplier.findMany({ orderBy: { name: "asc" } }),
    db.supplierCategory.findMany({ orderBy: { name: "asc" } }),
    db.supplierProfile.findMany(),
    db.supplierProduct.findMany(),
    db.documentDetail.findMany(),
    db.orderDetail.findMany(),
    db.customer.findMany({ orderBy: { name: "asc" } }),
    db.ledger.findMany({ orderBy: { id: "desc" } }),
    db.inventoryCount.findMany({ orderBy: { id: "desc" } }),
  ]);
  return {
    materials: materials.map((row) => [row.code, row.name, row.category, row.unit, row.quantity, row.minimum, row.price]),
    material_profiles: Object.fromEntries(materialProfiles.map((row) => [row.code, JSON.parse(row.profileJson)])),
    receipts: receipts.map((row) => [row.id, row.date, row.party, row.lineCount, row.total]),
    issues: issues.map((row) => [row.id, row.date, row.party, row.orderId, row.kind, row.lineCount]),
    orders: orders.map((row) => [row.id, row.customer, row.signedDate, row.product, row.quantity, row.issueCount, row.status]),
    suppliers: suppliers.map((row) => row.name),
    supplier_categories: supplierCategories.map((row) => row.name),
    supplier_profiles: Object.fromEntries(supplierProfiles.map((row) => [row.name, JSON.parse(row.profileJson)])),
    supplier_products: Object.fromEntries(supplierProducts.map((row) => [row.supplier, JSON.parse(row.productsJson)])),
    doc_details: Object.fromEntries(docDetails.map((row) => [row.id, JSON.parse(row.detailJson)])),
    order_details: Object.fromEntries(orderDetails.map((row) => [row.id, JSON.parse(row.detailJson)])),
    customers: customers.map((row) => row.name),
    ledger: ledger.map((row) => [row.date, row.materialCode, row.kind, row.quantity, row.reference]),
    counts: counts.map((row) => ({ id: row.id, date: row.date, note: row.note, created_by: row.createdBy, lines: JSON.parse(row.linesJson) })),
  };
}

export async function stateVersion(db: Db = prisma) {
  const row = await db.appMeta.findUnique({ where: { key: "version" } });
  return Number(row?.value || 0);
}

// Data and version from one read transaction, so a client never receives new
// data with an old version (or the reverse) while a save commits in between.
export function readSnapshot() {
  return prisma.$transaction(async (tx) => ({ data: await readState(tx), version: await stateVersion(tx) }));
}

function keysOutside(value, allowed) {
  return Object.keys(value).filter((key) => !allowed.has(key));
}

function exactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function badLine(line) {
  if (!line || typeof line !== "object" || !exactKeys(line, ["code", "qty", "unit_price", "supplier"])) return true;
  if (typeof line.code !== "string" || !line.code.trim() || typeof line.supplier !== "string" || line.supplier.length > 160) return true;
  return ["qty", "unit_price"].some((key) => !isNum(line[key]) || line[key] < 0);
}

export function validateState(data) {
  const keys = ["materials", "receipts", "issues", "orders", "suppliers", "customers", "ledger"];
  if (!data || typeof data !== "object" || keys.some((key) => !Array.isArray(data[key]))) {
    return "Dữ liệu hệ thống không đúng định dạng";
  }
  const counts = data.counts || [];
  if (!Array.isArray(counts) || counts.length > 20000) return "Danh sách phiếu kiểm kê không đúng định dạng";
  const seenCountIds = new Set();
  for (const count of counts) {
    if (!count || typeof count !== "object" || keysOutside(count, new Set(["id", "date", "note", "created_by", "lines"])).length) {
      return "Phiếu kiểm kê không đúng định dạng";
    }
    const { id, date, note, created_by: createdBy, lines } = count;
    if (typeof id !== "string" || !/^[A-Za-z0-9._/-]{1,120}$/.test(id) || seenCountIds.has(id) || typeof date !== "string" || date.length > 20 || typeof note !== "string" || note.length > 1000 || typeof createdBy !== "string" || createdBy.length > 60 || !Array.isArray(lines) || !lines.length || lines.length > 20000) {
      return "Thông tin phiếu kiểm kê không hợp lệ";
    }
    seenCountIds.add(id);
    const seenCodes = new Set();
    for (const line of lines) {
      if (!line || !exactKeys(line, ["code", "before", "counted", "delta"]) || typeof line.code !== "string" || !line.code.trim() || seenCodes.has(line.code)) {
        return "Dòng kiểm kê không hợp lệ";
      }
      seenCodes.add(line.code);
      if ([line.before, line.counted, line.delta].some((value) => !isNum(value)) || line.before < 0 || line.counted < 0 || !close(line.counted - line.before, line.delta)) {
        return "Số liệu kiểm kê không hợp lệ";
      }
    }
  }

  const docDetails = data.doc_details || {};
  const validDocIds = new Set([...data.receipts, ...data.issues].filter((row) => Array.isArray(row) && typeof row[0] === "string").map((row) => row[0]));
  if (typeof docDetails !== "object" || Array.isArray(docDetails) || Object.keys(docDetails).length > 40000) return "Chi tiết chứng từ không đúng định dạng";
  for (const [docId, detail] of Object.entries(docDetails)) {
    if (!validDocIds.has(docId) || !detail || typeof detail !== "object" || keysOutside(detail, new Set(["note", "created_by", "lines", "history"])).length) return "Chi tiết chứng từ không hợp lệ";
    const note = detail.note || "";
    const createdBy = detail.created_by || "";
    const lines = detail.lines || [];
    const history = detail.history || [];
    if (typeof note !== "string" || note.length > 2000 || typeof createdBy !== "string" || createdBy.length > 60 || !Array.isArray(lines) || lines.length > 20000 || !Array.isArray(history) || history.length > 100) {
      return "Thông tin chi tiết phiếu không hợp lệ";
    }
    if (lines.some((line) => badLine(line) || line.qty <= 0)) return "Dòng chi tiết chứng từ không hợp lệ";
    for (const event of history) {
      if (!event || typeof event !== "object" || keysOutside(event, new Set(["at", "by", "action", "date", "party", "kind", "note", "lines"])).length) return "Lịch sử chỉnh sửa chứng từ không hợp lệ";
      if (["at", "by", "action", "date", "party", "kind", "note"].some((key) => event[key] !== undefined && (typeof event[key] !== "string" || event[key].length > 2000)) || !Array.isArray(event.lines || [])) {
        return "Lịch sử chỉnh sửa chứng từ không hợp lệ";
      }
      if ((event.lines || []).some((line) => badLine(line))) return "Lịch sử dòng phiếu không hợp lệ";
    }
  }

  const categories = data.supplier_categories || [];
  if (!Array.isArray(categories) || categories.length > 500 || categories.some((item) => typeof item !== "string" || !item.trim() || item.length > 80) || new Set(categories).size !== categories.length) {
    return "Danh mục loại nhà cung cấp không hợp lệ";
  }
  const profiles = data.supplier_profiles || {};
  const products = data.supplier_products || {};
  if (typeof profiles !== "object" || Array.isArray(profiles) || Object.keys(profiles).length > 1000) return "Hồ sơ nhà cung cấp không đúng định dạng";
  if (typeof products !== "object" || Array.isArray(products) || Object.keys(products).length > 1000) return "Danh sách sản phẩm nhà cung cấp không đúng định dạng";
  if (keys.some((key) => data[key].length > 20000)) return "Số dòng vượt giới hạn";
  if (data.materials.some((row) => !Array.isArray(row) || row.length !== 7 || typeof row[0] !== "string" || !/^[A-Za-z0-9._/-]{1,80}$/.test(row[0]) || row.slice(1, 4).some((value) => typeof value !== "string" || !value.trim()) || row.slice(4).some((value) => !isNum(value) || value < 0))) {
    return "Mỗi nguyên vật liệu cần đúng 7 cột và mã chỉ gồm chữ, số, dấu . _ / -";
  }
  const materialCodes = data.materials.map((row) => row[0]);
  if (new Set(materialCodes).size !== materialCodes.length) return "Mã nguyên vật liệu bị trùng";
  const materialCodeSet = new Set(materialCodes);
  const materialProfiles = data.material_profiles || {};
  const profileKeys = new Set(["photo", "supplier", "spec", "pack", "color", "size_spec", "lead_time", "moq", "customer", "note"]);
  if (typeof materialProfiles !== "object" || Array.isArray(materialProfiles) || Object.keys(materialProfiles).length > 20000) return "Hồ sơ nguyên vật liệu không đúng định dạng";
  for (const [code, profile] of Object.entries(materialProfiles)) {
    if (!materialCodeSet.has(code) || !profile || typeof profile !== "object" || keysOutside(profile, profileKeys).length) return "Hồ sơ nguyên vật liệu không hợp lệ";
    if (Object.entries(profile).some(([key, value]) => typeof value !== "string" || (key !== "photo" && value.length > 2000))) return "Hồ sơ nguyên vật liệu không hợp lệ";
    if (profile.photo && (profile.photo.length > 43700 || !imagePattern.test(profile.photo))) return "Ảnh nguyên vật liệu cần là JPEG, PNG hoặc WebP và không quá 32 KB";
    if (profile.supplier && !data.suppliers.includes(profile.supplier)) return "Nhà cung cấp trên hồ sơ NVL không có trong danh bạ";
    if (profile.customer && !data.customers.includes(profile.customer)) return "Khách hàng trên hồ sơ NVL không có trong danh bạ";
  }
  for (const detail of Object.values(docDetails)) {
    if ((detail.lines || []).some((line) => !materialCodeSet.has(line.code))) return "Dòng chứng từ tham chiếu mã nguyên vật liệu không tồn tại";
  }

  const orderDetails = data.order_details || {};
  const orderIds = new Set(data.orders.filter((row) => Array.isArray(row) && typeof row[0] === "string").map((row) => row[0]));
  if (typeof orderDetails !== "object" || Array.isArray(orderDetails) || Object.keys(orderDetails).length > 20000) return "Định mức đơn hàng không đúng định dạng";
  for (const [orderId, detail] of Object.entries(orderDetails)) {
    if (!orderIds.has(orderId) || !detail || typeof detail !== "object" || keysOutside(detail, new Set(["unit", "extra_pct", "materials", "note", "photo"])).length) return "Chi tiết đơn hàng không hợp lệ";
    const extra = detail.extra_pct ?? 0;
    const planned = detail.materials || [];
    if ((detail.unit && typeof detail.unit !== "string") || (detail.unit || "").length > 40 || (detail.note && typeof detail.note !== "string") || (detail.note || "").length > 2000 || !isNum(extra) || extra < 0 || extra > 1000 || !Array.isArray(planned) || planned.length > 1000) {
      return "Thông tin hợp đồng hoặc tỷ lệ xuất dư không hợp lệ";
    }
    const seen = new Set();
    for (const line of planned) {
      if (!line || !exactKeys(line, ["code", "qty"]) || typeof line.code !== "string" || !materialCodeSet.has(line.code) || seen.has(line.code) || !isNum(line.qty) || line.qty <= 0) {
        return "Định mức NVL phải là mã hợp lệ và số lượng lớn hơn 0";
      }
      seen.add(line.code);
    }
    const photo = detail.photo || "";
    if (typeof photo !== "string" || photo.length > 43700 || (photo && !imagePattern.test(photo))) return "Ảnh sản phẩm cần là JPEG, PNG hoặc WebP và không quá 32 KB";
  }

  const widths = { receipts: 5, issues: 6, orders: 7, ledger: 5 };
  for (const [name, width] of Object.entries(widths)) {
    if (data[name].some((row) => !Array.isArray(row) || row.length !== width)) return `Dữ liệu ${name} không đúng số cột`;
  }
  if ([...data.suppliers, ...data.customers].some((value) => typeof value !== "string" || !value.trim() || value.length > 160)) return "Danh bạ phải là danh sách tên dạng văn bản";
  for (const [supplier, items] of Object.entries(products)) {
    if (!data.suppliers.includes(supplier) || !Array.isArray(items) || items.length > 500) return "Sản phẩm phải thuộc một nhà cung cấp và không vượt 500 dòng";
    for (const product of items) {
      if (!product || typeof product !== "object" || keysOutside(product, new Set(["id", "name", "unit", "price", "note", "photo"])).length) return "Thông tin sản phẩm nhà cung cấp không hợp lệ";
      const price = product.price ?? 0;
      if (["id", "name", "unit", "note", "photo"].some((key) => product[key] !== undefined && typeof product[key] !== "string") || !String(product.id || "").trim() || !String(product.name || "").trim() || String(product.id).length > 120 || String(product.name).length > 160 || String(product.unit || "").length > 40 || String(product.note || "").length > 1000 || !isNum(price) || price < 0) {
        return "Thông tin sản phẩm nhà cung cấp không hợp lệ";
      }
      if (product.photo && (product.photo.length > 43700 || !imagePattern.test(product.photo))) return "Ảnh sản phẩm cần là JPEG, PNG hoặc WebP và không quá 32 KB";
    }
  }
  const profileFields = new Set(["logo", "short_code", "products", "categories", "phone", "messenger", "address", "source", "currency", "foreign_price", "exchange_rate", "delivery_days", "note"]);
  for (const [name, profile] of Object.entries(profiles)) {
    if (!data.suppliers.includes(name) || !profile || typeof profile !== "object" || keysOutside(profile, profileFields).length || Object.values(profile).some((value) => typeof value !== "string" || value.length > 1200)) {
      return "Thông tin hồ sơ nhà cung cấp không hợp lệ";
    }
    if (profile.logo && (profile.logo.length > 43700 || !imagePattern.test(profile.logo))) return "Ảnh nhà cung cấp cần là JPEG, PNG hoặc WebP và không quá 32 KB";
  }
  const imageSize = Object.values(profiles).reduce((sum, profile) => sum + (profile.logo || "").length, 0)
    + Object.values(products).flat().reduce((sum, product) => sum + (product.photo || "").length, 0)
    + Object.values(orderDetails).reduce((sum, detail) => sum + (detail.photo || "").length, 0)
    + Object.values(materialProfiles).reduce((sum, profile) => sum + (profile.photo || "").length, 0);
  if (imageSize > 8000000) return "Tổng dung lượng ảnh hồ sơ, sản phẩm và đơn hàng vượt giới hạn 8 MB";
  if (data.ledger.some((row) => row.slice(0, 3).some((value) => typeof value !== "string") || !["Nhập", "Xuất", "Kiểm kê"].includes(row[2]) || !isNum(row[3]) || typeof row[4] !== "string")) {
    return "Dòng sổ kho có dữ liệu không hợp lệ";
  }
  return rowError(data) || stockLedgerError(data) || orderAllowanceError(data);
}

const idPattern = /^[A-Za-z0-9._/-]{1,120}$/;

function text(value, max, required = true) {
  return typeof value === "string" && value.length <= max && (!required || value.trim().length > 0);
}

function duplicate(values) {
  return new Set(values).size !== values.length;
}

// Field types and lengths for every table row, so bad input is a 400 here
// instead of a database error (or a silently truncated value) later.
function rowError(data) {
  if (data.materials.some((row) => !text(row[1], 200) || !text(row[2], 80) || !text(row[3], 40))) {
    return "Tên NVL tối đa 200 ký tự, nhóm tối đa 80, đơn vị tính tối đa 40";
  }
  if (duplicate(data.suppliers) || duplicate(data.customers)) return "Danh bạ có tên bị trùng";
  const receiptIds = data.receipts.map((row) => row[0]);
  const issueIds = data.issues.map((row) => row[0]);
  const orderIds = data.orders.map((row) => row[0]);
  if ([...receiptIds, ...issueIds, ...orderIds].some((id) => typeof id !== "string" || !idPattern.test(id))) {
    return "Mã phiếu/đơn hàng chỉ gồm chữ, số, dấu . _ / - (tối đa 120 ký tự)";
  }
  if (duplicate([...receiptIds, ...issueIds]) || duplicate(orderIds)) return "Mã phiếu hoặc mã đơn hàng bị trùng";
  if (data.receipts.some((row) => !text(row[1], 20) || !text(row[2], 2000, false) || !Number.isInteger(row[3]) || row[3] < 0 || !isNum(row[4]) || row[4] < 0)) {
    return "Thông tin phiếu nhập không hợp lệ";
  }
  const orderIdSet = new Set(orderIds);
  if (data.issues.some((row) => !text(row[1], 20) || !text(row[2], 160, false) || typeof row[3] !== "string" || (row[3] !== "—" && !orderIdSet.has(row[3])) || !text(row[4], 80, false) || !Number.isInteger(row[5]) || row[5] < 0)) {
    return "Thông tin phiếu xuất không hợp lệ hoặc tham chiếu đơn hàng không tồn tại";
  }
  if (data.orders.some((row) => !text(row[1], 160, false) || !text(row[2], 20, false) || !text(row[3], 300, false) || !text(row[4], 80, false) || !text(row[5], 20, false) || !text(row[6], 40))) {
    return "Thông tin đơn hàng không hợp lệ";
  }
  if (data.ledger.some((row) => !text(row[0], 20) || !text(row[1], 80) || !text(row[4], 120))) return "Dòng sổ kho có dữ liệu không hợp lệ";
  return null;
}

// Every stock change in the UI writes ledger rows (receipts, issues, counts,
// "Tồn ban đầu" and "Sửa hồ sơ" adjustments), so each material's stock must
// equal the sum of its ledger movements, and every movement must belong to an
// existing material.
function stockLedgerError(data) {
  const sums = new Map();
  for (const row of data.ledger) addCount(sums, row[1], row[3]);
  const codes = new Set(data.materials.map((row) => row[0]));
  const orphan = [...sums.keys()].find((code) => !codes.has(code));
  if (orphan) return `Sổ kho có giao dịch của mã NVL không tồn tại: ${orphan}`;
  for (const row of data.materials) {
    if (!close(row[4], sums.get(row[0]) || 0)) return `Tồn kho mã ${row[0]} không khớp với tổng giao dịch trên sổ kho`;
  }
  return null;
}

function orderAllowanceError(data) {
  const details = data.order_details || {};
  const issueById = new Map(data.issues.filter((row) => Array.isArray(row) && row.length === 6 && typeof row[0] === "string").map((row) => [row[0], row]));
  const issued = new Map();
  for (const event of data.ledger) {
    if (event[2] !== "Xuất") continue;
    const issue = issueById.get(event[4]);
    if (issue && typeof issue[3] === "string" && details[issue[3]]) {
      const key = `${issue[3]}\0${event[1]}`;
      issued.set(key, (issued.get(key) || 0) + Math.abs(Number(event[3])));
    }
  }
  for (const [orderId, detail] of Object.entries(details)) {
    const planned = new Map((detail.materials || []).map((line) => [line.code, Number(line.qty)]));
    if (!planned.size) continue;
    const multiplier = 1 + Number(detail.extra_pct || 0) / 100;
    for (const [key, quantity] of issued) {
      const [linkedOrderId, code] = key.split("\0");
      if (linkedOrderId !== orderId) continue;
      if (!planned.has(code)) return `Đơn hàng ${orderId} chưa khai báo định mức cho mã ${code}`;
      const maximum = planned.get(code) * multiplier;
      if (quantity > maximum + 1e-8) return `Xuất kho vượt định mức đơn ${orderId}, mã ${code}: tối đa ${maximum}`;
    }
  }
  return null;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function warehouseChangeError(data, old) {
  if (!sameJson(data.suppliers, old.suppliers) || !sameJson(data.customers, old.customers) || !sameJson(data.supplier_profiles || {}, old.supplier_profiles) || !sameJson(data.supplier_categories || [], old.supplier_categories) || !sameJson(data.supplier_products || {}, old.supplier_products)) {
    return "Nhân viên kho không được sửa danh mục nhà cung cấp hoặc khách hàng";
  }
  if (!sameJson(data.material_profiles || {}, old.material_profiles)) return "Nhân viên kho không được sửa hồ sơ nguyên vật liệu";
  const newDetails = data.doc_details || {};
  if (Object.entries(old.doc_details).some(([id, detail]) => !sameJson(newDetails[id], detail))) return "Nhân viên kho không được sửa hoặc xóa chi tiết chứng từ cũ";
  const newOrders = data.order_details || {};
  if (Object.entries(old.order_details).some(([id, detail]) => !sameJson(newOrders[id], detail))) return "Nhân viên kho không được sửa hoặc xóa định mức đơn hàng đã lưu";
  if (data.materials.length !== old.materials.length) return "Nhân viên kho không được thêm hoặc xóa mã nguyên vật liệu";
  const oldByCode = new Map(old.materials.map((row) => [row[0], row]));
  const newByCode = new Map(data.materials.map((row) => [row[0], row]));
  if ([...oldByCode.keys()].some((code) => !newByCode.has(code)) || oldByCode.size !== newByCode.size) return "Danh mục nguyên vật liệu đã thay đổi";

  function appended(rows, oldRows, key) {
    const oldMap = new Map(oldRows.map((row) => [row[key], row]));
    const present = rows.filter((row) => oldMap.has(row[key]));
    if (!sameJson(present, oldRows)) return null;
    if (new Set(rows.map((row) => row[key])).size !== rows.length) return null;
    return rows.filter((row) => !oldMap.has(row[key]));
  }
  const newReceipts = appended(data.receipts, old.receipts, 0);
  const newIssues = appended(data.issues, old.issues, 0);
  const addedOrders = appended(data.orders, old.orders, 0);
  const newCounts = appended(data.counts || [], old.counts, "id");
  if ([newReceipts, newIssues, addedOrders, newCounts].some((rows) => rows === null)) {
    return "Nhân viên kho chỉ được tạo phiếu mới; không được sửa hoặc xóa chứng từ đã lưu";
  }
  for (const row of data.orders) {
    const previous = old.orders.find((item) => item[0] === row[0]);
    if (previous && (!sameJson(row.slice(1, 5), previous.slice(1, 5)) || !["Hoàn thành", "Đang thực hiện", previous[6]].includes(row[6]))) {
      return "Nhân viên kho không được sửa nội dung hợp đồng đã lưu";
    }
  }
  const countOf = (rows) => {
    const map = new Map();
    for (const row of rows) addCount(map, JSON.stringify(row));
    return map;
  };
  const oldLedger = countOf(old.ledger);
  const newLedger = countOf(data.ledger);
  for (const [key, amount] of oldLedger) {
    if ((newLedger.get(key) || 0) < amount) return "Nhân viên kho không được sửa hoặc xóa giao dịch đã ghi sổ";
  }
  const addedLedger = [];
  for (const [key, amount] of newLedger) addedLedger.push(...Array((amount - (oldLedger.get(key) || 0))).fill(JSON.parse(key)));
  const receiptIds = new Set(newReceipts.map((row) => row[0]));
  const issueIds = new Set(newIssues.map((row) => row[0]));
  const countIds = new Set(newCounts.map((row) => row.id));
  const extraDocs = Object.keys(newDetails).filter((id) => !(id in old.doc_details) && !receiptIds.has(id) && !issueIds.has(id));
  if (extraDocs.length) return "Chi tiết mới phải thuộc phiếu nhập hoặc xuất mới";
  const extraOrders = Object.keys(newOrders).filter((id) => !(id in old.order_details) && !addedOrders.some((row) => row[0] === id));
  if (extraOrders.length) return "Định mức mới phải thuộc đơn hàng may mới";
  if (!addedLedger.length && (newReceipts.length || newIssues.length || newCounts.length)) return "Phiếu kho mới cần có ít nhất một dòng giao dịch";
  for (const row of addedLedger) {
    const [date, code, kind, amount, ref] = row;
    void date; void code;
    if ((kind === "Nhập" && !receiptIds.has(ref)) || (kind === "Xuất" && !issueIds.has(ref)) || (kind === "Kiểm kê" && !countIds.has(ref))) {
      return "Giao dịch mới phải thuộc phiếu nhập, xuất hoặc kiểm kê mới";
    }
    if ((kind === "Nhập" && amount <= 0) || (kind === "Xuất" && amount >= 0)) return "Số lượng nhập/xuất không hợp lệ";
  }
  const newPrice = new Map();
  for (const row of newReceipts) {
    const events = addedLedger.filter((item) => item[4] === row[0] && item[2] === "Nhập");
    const detail = (data.doc_details || {})[row[0]];
    if (!Number.isInteger(row[3]) || row[3] !== events.length || row[3] < 1) return "Số dòng của phiếu nhập không khớp với sổ giao dịch";
    if (!isNum(row[4]) || row[4] < 0) return "Tổng tiền phiếu nhập không hợp lệ";
    if (!detail || !Array.isArray(detail.lines)) return "Phiếu nhập cần lưu chi tiết từng mã, số lượng, đơn giá và nguồn hàng";
    const detailQty = new Map();
    let expectedTotal = 0;
    const suppliers = [];
    for (const line of detail.lines) {
      if (!line.supplier) return "Mỗi dòng nhập cần có nhà cung cấp";
      addCount(detailQty, line.code, line.qty);
      expectedTotal += line.qty * line.unit_price;
      if (line.unit_price > 0) newPrice.set(line.code, line.unit_price);
      if (!suppliers.includes(line.supplier)) suppliers.push(line.supplier);
    }
    const eventQty = new Map();
    for (const event of events) addCount(eventQty, event[1], event[3]);
    if (detail.lines.length !== row[3] || !sameCount(detailQty, eventQty) || !close(row[4], expectedTotal, 0.01)) {
      return "Chi tiết và tổng tiền của phiếu nhập không khớp với sổ kho";
    }
    if (row[2] !== suppliers.join(", ")) return "Nguồn hàng trên phiếu nhập không khớp với các dòng chi tiết";
  }
  for (const row of newIssues) {
    const events = addedLedger.filter((item) => item[4] === row[0] && item[2] === "Xuất");
    const detail = (data.doc_details || {})[row[0]];
    if (!Number.isInteger(row[5]) || row[5] !== events.length || row[5] < 1) return "Số dòng của phiếu xuất không khớp với sổ giao dịch";
    if (!detail || (detail.lines || []).length !== row[5]) return "Phiếu xuất cần lưu chi tiết các dòng nguyên vật liệu";
    const detailQty = new Map();
    for (const line of detail.lines) addCount(detailQty, line.code, -line.qty);
    const eventQty = new Map();
    for (const event of events) addCount(eventQty, event[1], event[3]);
    if (!sameCount(detailQty, eventQty)) return "Chi tiết phiếu xuất không khớp với sổ kho";
  }
  for (const count of newCounts) {
    const lines = addedLedger.filter((item) => item[4] === count.id && item[2] === "Kiểm kê");
    const expected = countOf(count.lines.map((line) => [line.code, line.delta]));
    const actual = countOf(lines.map((line) => [line[1], line[3]]));
    if (lines.length !== count.lines.length || !sameCount(expected, actual)) return "Các dòng kiểm kê không khớp với sổ giao dịch";
  }
  const delta = new Map();
  for (const row of addedLedger) addCount(delta, row[1], row[3]);
  const receiptCodes = new Set(addedLedger.filter((row) => row[2] === "Nhập").map((row) => row[1]));
  for (const [code, before] of oldByCode) {
    const after = newByCode.get(code);
    const priceOk = after[6] === before[6] || (receiptCodes.has(code) && close(after[6], newPrice.get(code) ?? before[6]));
    if (!sameJson(after.slice(0, 4), before.slice(0, 4)) || after[5] !== before[5] || !priceOk) return "Nhân viên kho không được sửa thông tin hoặc đơn giá danh mục";
    if (!close(after[4], before[4] + (delta.get(code) || 0))) return "Tồn kho phải khớp với các phiếu giao dịch mới";
  }
  for (const order of old.orders) {
    const next = data.orders.find((row) => row[0] === order[0]);
    const added = newIssues.filter((issue) => issue[3] === order[0]).length;
    const expected = Number(order[5] || 0) + added;
    const actual = Number(next[5] || 0);
    if (!Number.isFinite(expected) || !Number.isFinite(actual) || actual !== expected) return "Số phiếu xuất của đơn hàng không khớp";
  }
  return null;
}

function whenRows(rows, query) {
  return rows.length ? [query] : [];
}

async function writeState(tx: Db, data) {
  const profiles = Object.entries(data.material_profiles || {}).map(([code, profile]) => ({ code, profileJson: JSON.stringify(profile) }));
  const supplierProfiles = Object.entries(data.supplier_profiles || {}).map(([name, profile]) => ({ name, profileJson: JSON.stringify(profile) }));
  const supplierProducts = Object.entries(data.supplier_products || {}).map(([supplier, products]) => ({ supplier, productsJson: JSON.stringify(products) }));
  const documents = Object.entries(data.doc_details || {}).map(([id, detail]) => ({ id, detailJson: JSON.stringify(detail) }));
  const orderDetails = Object.entries(data.order_details || {}).map(([id, detail]) => ({ id, detailJson: JSON.stringify(detail) }));
  await tx.materialProfile.deleteMany();
  await tx.supplierProfile.deleteMany();
  await tx.supplierProduct.deleteMany();
  await tx.documentDetail.deleteMany();
  await tx.orderDetail.deleteMany();
  await tx.material.deleteMany();
  await tx.receipt.deleteMany();
  await tx.issue.deleteMany();
  await tx.order.deleteMany();
  await tx.supplierCategory.deleteMany();
  await tx.supplier.deleteMany();
  await tx.customer.deleteMany();
  await tx.ledger.deleteMany();
  await tx.inventoryCount.deleteMany();
  if (data.materials.length) await tx.material.createMany({ data: data.materials.map((row) => ({ code: row[0], name: row[1], category: row[2], unit: row[3], quantity: row[4], minimum: row[5], price: row[6] })) });
  if (profiles.length) await tx.materialProfile.createMany({ data: profiles });
  if (data.receipts.length) await tx.receipt.createMany({ data: data.receipts.map((row) => ({ id: row[0], date: row[1], party: row[2], lineCount: row[3], total: row[4] })) });
  if (data.issues.length) await tx.issue.createMany({ data: data.issues.map((row) => ({ id: row[0], date: row[1], party: row[2], orderId: row[3], kind: row[4], lineCount: row[5] })) });
  if (data.orders.length) await tx.order.createMany({ data: data.orders.map((row) => ({ id: row[0], customer: row[1], signedDate: row[2], product: row[3], quantity: row[4], issueCount: row[5], status: row[6] })) });
  if (data.suppliers.length) await tx.supplier.createMany({ data: data.suppliers.map((name) => ({ name })) });
  if ((data.supplier_categories || []).length) await tx.supplierCategory.createMany({ data: data.supplier_categories.map((name) => ({ name })) });
  if (supplierProfiles.length) await tx.supplierProfile.createMany({ data: supplierProfiles });
  if (supplierProducts.length) await tx.supplierProduct.createMany({ data: supplierProducts });
  if (documents.length) await tx.documentDetail.createMany({ data: documents });
  if (orderDetails.length) await tx.orderDetail.createMany({ data: orderDetails });
  if (data.customers.length) await tx.customer.createMany({ data: data.customers.map((name) => ({ name })) });
  if (data.ledger.length) await tx.ledger.createMany({ data: [...data.ledger].reverse().map((row) => ({ date: row[0], materialCode: row[1], kind: row[2], quantity: row[3], reference: row[4] })) });
  if ((data.counts || []).length) await tx.inventoryCount.createMany({ data: [...data.counts].reverse().map((count) => ({ id: count.id, date: count.date, note: count.note, createdBy: count.created_by, linesJson: JSON.stringify(count.lines) })) });
}

// Replaces the whole state if and only if the stored version still equals
// `expected`. The first statement is the compare-and-swap UPDATE on the version
// row, which takes SQLite's write lock before anything is read, so the role and
// warehouse checks below see exactly the data being replaced. Any throw rolls
// the whole transaction back, including the version bump.
export function saveState(data, expected: number, username: string) {
  return prisma.$transaction(async (tx) => {
    const next = expected + 1;
    const swapped = await tx.appMeta.updateMany({ where: { key: "version", value: String(expected) }, data: { value: String(next) } });
    if (swapped.count !== 1) throw new StaleVersionError(await stateVersion(tx));
    const user = await tx.user.findUnique({ where: { username }, select: { role: true } });
    if (!user) throw new SaveForbiddenError("Vui lòng đăng nhập lại");
    if (user.role !== "admin") {
      const blocked = warehouseChangeError(data, await readState(tx));
      if (blocked) throw new SaveForbiddenError(blocked);
    }
    await writeState(tx, data);
    return next;
  }, { maxWait: 30_000, timeout: 60_000 });
}
