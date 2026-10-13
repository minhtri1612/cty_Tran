import { all, get, run } from "../config/database.js";

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

function listRows(db, sql) {
  return all(db, sql).map((row) => Object.values(row));
}

function jsonMap(db, sql) {
  return Object.fromEntries(all(db, sql).map((row) => {
    const [key, value] = Object.values(row);
    return [key, JSON.parse(value)];
  }));
}

export function readState(db) {
  return {
    materials: listRows(db, "SELECT code,name,category,unit,quantity,minimum,price FROM materials ORDER BY code"),
    material_profiles: jsonMap(db, "SELECT code,profile_json FROM material_profiles"),
    receipts: listRows(db, "SELECT id,date,party,line_count,total FROM receipts ORDER BY date DESC,id DESC"),
    issues: listRows(db, "SELECT id,date,party,order_id,kind,line_count FROM issues ORDER BY date DESC,id DESC"),
    orders: listRows(db, "SELECT id,customer,signed_date,product,quantity,issue_count,status FROM orders ORDER BY signed_date DESC,id DESC"),
    suppliers: all(db, "SELECT name FROM suppliers ORDER BY name").map((row) => row.name),
    supplier_categories: all(db, "SELECT name FROM supplier_categories ORDER BY name").map((row) => row.name),
    supplier_profiles: jsonMap(db, "SELECT name,profile_json FROM supplier_profiles"),
    supplier_products: jsonMap(db, "SELECT supplier,products_json FROM supplier_products"),
    doc_details: jsonMap(db, "SELECT id,detail_json FROM document_details"),
    order_details: jsonMap(db, "SELECT id,detail_json FROM order_details"),
    customers: all(db, "SELECT name FROM customers ORDER BY name").map((row) => row.name),
    ledger: listRows(db, "SELECT date,material_code,kind,quantity,reference FROM ledger ORDER BY id DESC"),
    counts: all(db, "SELECT id,date,note,created_by,lines_json FROM inventory_counts ORDER BY id DESC").map((row) => ({
      id: row.id, date: row.date, note: row.note, created_by: row.created_by, lines: JSON.parse(row.lines_json),
    })),
  };
}

export function stateVersion(db) {
  return Number(get(db, "SELECT value FROM app_meta WHERE key='version'").value);
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
    if (Object.values(profile).some((value) => typeof value !== "string" || value.length > 2000)) return "Hồ sơ nguyên vật liệu không hợp lệ";
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
  return orderAllowanceError(data);
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

export function warehouseChangeError(db, data) {
  const old = readState(db);
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

export function writeState(db, data) {
  const tables = ["materials", "material_profiles", "receipts", "issues", "orders", "supplier_products", "supplier_profiles", "document_details", "order_details", "supplier_categories", "suppliers", "customers", "ledger", "inventory_counts"];
  for (const table of tables) run(db, `DELETE FROM ${table}`);
  const insert = db.prepare.bind(db);
  for (const row of data.materials) insert("INSERT INTO materials VALUES(?,?,?,?,?,?,?)").run(...row);
  for (const [code, profile] of Object.entries(data.material_profiles || {})) insert("INSERT INTO material_profiles(code,profile_json) VALUES(?,?)").run(code, JSON.stringify(profile));
  for (const row of data.receipts) insert("INSERT INTO receipts VALUES(?,?,?,?,?)").run(...row);
  for (const row of data.issues) insert("INSERT INTO issues VALUES(?,?,?,?,?,?)").run(...row);
  for (const row of data.orders) insert("INSERT INTO orders VALUES(?,?,?,?,?,?,?)").run(...row);
  for (const name of data.suppliers) insert("INSERT INTO suppliers VALUES(?)").run(name);
  for (const name of data.supplier_categories || []) insert("INSERT INTO supplier_categories VALUES(?)").run(name);
  for (const [name, profile] of Object.entries(data.supplier_profiles || {})) insert("INSERT INTO supplier_profiles(name,profile_json) VALUES(?,?)").run(name, JSON.stringify(profile));
  for (const [name, products] of Object.entries(data.supplier_products || {})) insert("INSERT INTO supplier_products(supplier,products_json) VALUES(?,?)").run(name, JSON.stringify(products));
  for (const [id, detail] of Object.entries(data.doc_details || {})) insert("INSERT INTO document_details(id,detail_json) VALUES(?,?)").run(id, JSON.stringify(detail));
  for (const [id, detail] of Object.entries(data.order_details || {})) insert("INSERT INTO order_details(id,detail_json) VALUES(?,?)").run(id, JSON.stringify(detail));
  for (const name of data.customers) insert("INSERT INTO customers VALUES(?)").run(name);
  for (const row of [...data.ledger].reverse()) insert("INSERT INTO ledger(date,material_code,kind,quantity,reference) VALUES(?,?,?,?,?)").run(...row);
  for (const count of [...(data.counts || [])].reverse()) insert("INSERT INTO inventory_counts(id,date,note,created_by,lines_json) VALUES(?,?,?,?,?)").run(count.id, count.date, count.note, count.created_by, JSON.stringify(count.lines));
}
