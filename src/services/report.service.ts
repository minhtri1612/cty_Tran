import { crc32 } from "node:zlib";
import { all } from "../config/database.js";

function columnName(index) {
  let name = "";
  while (index) {
    index -= 1;
    name = String.fromCharCode(65 + (index % 26)) + name;
    index = Math.floor(index / 26);
  }
  return name;
}

function sheetXml(rows) {
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const ref = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}" t="n"><v>${value}</v></c>`;
      const text = String(value ?? "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><sheetData>${body}</sheetData></worksheet>`;
}

function zipStored(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = Buffer.from(file.data);
    const checksum = crc32(data) >>> 0;
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, data);
    const header = Buffer.alloc(46 + name.length);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    name.copy(header, 46);
    central.push(header);
    offset += local.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function buildReport(db) {
  const materials = all(db, "SELECT code,name,category,unit,quantity,minimum,price FROM materials ORDER BY code").map((row) => Object.values(row));
  const receipts = all(db, "SELECT id,date,party,line_count,total FROM receipts ORDER BY date DESC,id DESC").map((row) => Object.values(row));
  const issues = all(db, "SELECT id,date,party,order_id,kind,line_count FROM issues ORDER BY date DESC,id DESC").map((row) => Object.values(row));
  const ledger = all(db, "SELECT date,material_code,kind,quantity,reference FROM ledger ORDER BY id DESC").map((row) => Object.values(row));
  const names = new Map(materials.map((row) => [row[0], row[1]]));
  const units = new Map(materials.map((row) => [row[0], row[3]]));
  const sheets = [
    ["Nguyên vật liệu", [["Mã NVL", "Tên nguyên vật liệu", "Nhóm", "ĐVT", "Tồn hiện tại", "Tồn tối thiểu", "Đơn giá gần nhất (₫)", "Giá trị tồn (₫)"], ...materials.map((row) => [...row, row[4] * row[6]])]],
    ["Phiếu nhập", [["Mã phiếu", "Ngày", "Nhà cung cấp", "Số dòng", "Tổng tiền (₫)"], ...receipts]],
    ["Phiếu xuất", [["Mã phiếu", "Ngày", "Khách hàng", "Đơn hàng", "Loại xuất", "Số dòng"], ...issues]],
    ["Sổ kho", [["Ngày", "Mã NVL", "Tên NVL", "Loại", "Số lượng", "ĐVT", "Tham chiếu"], ...ledger.map((row) => [row[0], row[1], names.get(row[1]) || "NVL đã xóa", row[2], row[3], units.get(row[1]) || "", row[4]])]],
  ];
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([title], index) => `<sheet name="${title}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>` },
    ...sheets.map(([, rows], index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheetXml(rows) })),
  ];
  return zipStored(files);
}
