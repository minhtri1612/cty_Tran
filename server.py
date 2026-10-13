from __future__ import annotations

import collections
import hashlib
import hmac
import io
import json
import math
import os
import re
import secrets
import sqlite3
import threading
import time
import zipfile
import xml.etree.ElementTree as ET
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

BASE = Path(__file__).resolve().parent
DATA_DIR = BASE / "data"
DB_PATH = DATA_DIR / "scm.sqlite3"
COOKIE_NAME = "hn_scm_session"
SESSION_SECONDS = 12 * 60 * 60
PBKDF2_ROUNDS = 310_000
LOGIN_FAILURES = {}
LOGIN_LOCK = threading.Lock()


class SQLiteConnection(sqlite3.Connection):
    """Commit or roll back request transactions, then release the file handle."""

    def __exit__(self, kind, value, traceback):
        try:
            if kind:
                self.rollback()
            else:
                self.commit()
        finally:
            self.close()
        return False


class PgRecord(tuple):
    def __new__(cls, values, names):
        obj = super().__new__(cls, values)
        obj.names = names
        return obj

    def __getitem__(self, key):
        return super().__getitem__(self.names.index(key) if isinstance(key, str) else key)


def pg_record_factory(cursor):
    names = [column.name for column in cursor.description]
    return lambda values: PgRecord(values, names)


class PgConnection:
    def __init__(self, raw):
        self.raw = raw

    def execute(self, sql, params=()):
        sql = sql.replace("?", "%s")
        if sql == "BEGIN IMMEDIATE":
            sql = "BEGIN"
        return self.raw.execute(sql, params)

    def executemany(self, sql, params):
        return self.raw.executemany(sql.replace("?", "%s"), params)

    def executescript(self, script):
        for statement in script.split(";"):
            if statement.strip():
                self.execute(statement)

    def commit(self):
        self.raw.commit()

    def rollback(self):
        self.raw.rollback()

    def __enter__(self):
        return self

    def __exit__(self, kind, value, traceback):
        try:
            self.raw.rollback() if kind else self.raw.commit()
        finally:
            self.raw.close()


def connect():
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if database_url:
        import psycopg
        if database_url.startswith("postgres://"):
            database_url = "postgresql://" + database_url[len("postgres://"):]
        return PgConnection(psycopg.connect(database_url, row_factory=pg_record_factory, connect_timeout=10))
    db_path = Path(os.environ.get("SCM_DB_PATH", DB_PATH))
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(db_path, timeout=20, factory=SQLiteConnection)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA journal_mode = WAL")
    db.execute("PRAGMA busy_timeout = 20000")
    return db


def initialize():
    with connect() as db:
        ledger_id = "BIGSERIAL PRIMARY KEY" if os.environ.get("DATABASE_URL") else "INTEGER PRIMARY KEY AUTOINCREMENT"
        salt_type = "BYTEA" if os.environ.get("DATABASE_URL") else "BLOB"
        hash_type = salt_type
        db.executescript(f"""
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password_salt {salt_type} NOT NULL,
            password_hash {hash_type} NOT NULL,
            created_at BIGINT NOT NULL,
            role TEXT NOT NULL DEFAULT 'admin'
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS materials (
            code TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            unit TEXT NOT NULL,
            quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0),
            minimum REAL NOT NULL DEFAULT 0 CHECK(minimum >= 0),
            price REAL NOT NULL DEFAULT 0 CHECK(price >= 0)
        );
        CREATE TABLE IF NOT EXISTS material_profiles (
            code TEXT PRIMARY KEY,
            profile_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS receipts (
            id TEXT PRIMARY KEY, date TEXT NOT NULL, party TEXT NOT NULL,
            line_count INTEGER NOT NULL, total REAL NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS issues (
            id TEXT PRIMARY KEY, date TEXT NOT NULL, party TEXT NOT NULL,
            order_id TEXT NOT NULL, kind TEXT NOT NULL, line_count INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY, customer TEXT NOT NULL, signed_date TEXT NOT NULL,
            product TEXT NOT NULL, quantity TEXT NOT NULL, issue_count TEXT NOT NULL,
            status TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS suppliers (name TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS supplier_categories (name TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS supplier_profiles (
            name TEXT PRIMARY KEY REFERENCES suppliers(name) ON DELETE CASCADE,
            profile_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS supplier_products (
            supplier TEXT PRIMARY KEY, products_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS document_details (
            id TEXT PRIMARY KEY, detail_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS order_details (
            id TEXT PRIMARY KEY, detail_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS customers (name TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS ledger (
            id {ledger_id}, date TEXT NOT NULL,
            material_code TEXT NOT NULL, kind TEXT NOT NULL,
            quantity REAL NOT NULL, reference TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS inventory_counts (
            id TEXT PRIMARY KEY, date TEXT NOT NULL, note TEXT NOT NULL,
            created_by TEXT NOT NULL, lines_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
        CREATE INDEX IF NOT EXISTS ledger_material_date ON ledger(material_code, date);
        """)
        db.execute("INSERT INTO app_meta(key,value) VALUES('version','0') ON CONFLICT(key) DO NOTHING")
        if not os.environ.get("DATABASE_URL"):
            columns = {row["name"] for row in db.execute("PRAGMA table_info(users)")}
            if "role" not in columns:
                db.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'")


def seed_data(db):
    db.execute("INSERT INTO app_meta(key,value) VALUES('seeded','1') ON CONFLICT(key) DO NOTHING")


def password_hash(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)


def warehouse_change_error(db, data):
    """Restrict snapshot writes from warehouse accounts to append-only stock activity."""
    old_materials = [list(r) for r in db.execute("SELECT code,name,category,unit,quantity,minimum,price FROM materials ORDER BY code")]
    old_material_profiles = {r[0]: json.loads(r[1]) for r in db.execute("SELECT code,profile_json FROM material_profiles")}
    old_receipts = [list(r) for r in db.execute("SELECT id,date,party,line_count,total FROM receipts ORDER BY date DESC,id DESC")]
    old_issues = [list(r) for r in db.execute("SELECT id,date,party,order_id,kind,line_count FROM issues ORDER BY date DESC,id DESC")]
    old_orders = [list(r) for r in db.execute("SELECT id,customer,signed_date,product,quantity,issue_count,status FROM orders ORDER BY signed_date DESC,id DESC")]
    old_suppliers = [r[0] for r in db.execute("SELECT name FROM suppliers ORDER BY name")]
    old_categories = [r[0] for r in db.execute("SELECT name FROM supplier_categories ORDER BY name")]
    old_profiles = {r[0]: json.loads(r[1]) for r in db.execute("SELECT name,profile_json FROM supplier_profiles")}
    old_supplier_products = {r[0]: json.loads(r[1]) for r in db.execute("SELECT supplier,products_json FROM supplier_products")}
    old_document_details = {r[0]: json.loads(r[1]) for r in db.execute("SELECT id,detail_json FROM document_details")}
    old_order_details = {r[0]: json.loads(r[1]) for r in db.execute("SELECT id,detail_json FROM order_details")}
    old_customers = [r[0] for r in db.execute("SELECT name FROM customers ORDER BY name")]
    old_ledger = [list(r) for r in db.execute("SELECT date,material_code,kind,quantity,reference FROM ledger ORDER BY id DESC")]
    old_counts = [{"id": r[0], "date": r[1], "note": r[2], "created_by": r[3], "lines": json.loads(r[4])} for r in db.execute("SELECT id,date,note,created_by,lines_json FROM inventory_counts ORDER BY id DESC")]

    if data["suppliers"] != old_suppliers or data["customers"] != old_customers or data.get("supplier_profiles", {}) != old_profiles or data.get("supplier_categories", []) != old_categories or data.get("supplier_products", {}) != old_supplier_products:
        return "Nhân viên kho không được sửa danh mục nhà cung cấp hoặc khách hàng"
    new_document_details = data.get("doc_details", {})
    if any(new_document_details.get(doc_id) != detail for doc_id, detail in old_document_details.items()):
        return "Nhân viên kho không được sửa hoặc xóa chi tiết chứng từ cũ"
    new_order_details = data.get("order_details", {})
    if any(new_order_details.get(order_id) != detail for order_id, detail in old_order_details.items()):
        return "Nhân viên kho không được sửa hoặc xóa định mức đơn hàng đã lưu"
    if data.get("material_profiles", {}) != old_material_profiles:
        return "Nhân viên kho không được sửa hồ sơ nguyên vật liệu"
    if len(data["materials"]) != len(old_materials):
        return "Nhân viên kho không được thêm hoặc xóa mã nguyên vật liệu"
    old_by_code = {r[0]: r for r in old_materials}
    new_by_code = {r[0]: r for r in data["materials"]}
    if old_by_code.keys() != new_by_code.keys():
        return "Danh mục nguyên vật liệu đã thay đổi"

    def appended_rows(rows, old_rows, key):
        old_map = {row[key]: row for row in old_rows}
        present = [row for row in rows if row[key] in old_map]
        if present != old_rows:
            return None
        if len({row[key] for row in rows}) != len(rows):
            return None
        return [row for row in rows if row[key] not in old_map]

    new_receipts = appended_rows(data["receipts"], old_receipts, 0)
    new_issues = appended_rows(data["issues"], old_issues, 0)
    new_orders = appended_rows(data["orders"], old_orders, 0)
    new_counts = appended_rows(data.get("counts", []), old_counts, "id")
    if any(rows is None for rows in (new_receipts, new_issues, new_orders, new_counts)):
        return "Nhân viên kho chỉ được tạo phiếu mới; không được sửa hoặc xóa chứng từ đã lưu"
    if any(row[1:5] != old[1:5] or row[6] not in (old[6], "Hoàn thành", "Đang thực hiện") for row in data["orders"] for old in old_orders if row[0] == old[0]):
        return "Nhân viên kho không được sửa nội dung hợp đồng đã lưu"

    old_ledger_counts = collections.Counter(tuple(row) for row in old_ledger)
    new_ledger_counts = collections.Counter(tuple(row) for row in data["ledger"])
    if old_ledger_counts - new_ledger_counts:
        return "Nhân viên kho không được sửa hoặc xóa giao dịch đã ghi sổ"
    added_ledger = list((new_ledger_counts - old_ledger_counts).elements())
    receipt_ids = {row[0] for row in new_receipts}
    issue_ids = {row[0] for row in new_issues}
    count_ids = {row["id"] for row in new_counts}
    if set(new_document_details) - set(old_document_details) - receipt_ids - issue_ids:
        return "Chi tiết mới phải thuộc phiếu nhập hoặc xuất mới"
    if set(new_order_details) - set(old_order_details) - {row[0] for row in new_orders}:
        return "Định mức mới phải thuộc đơn hàng may mới"
    if not added_ledger and (new_receipts or new_issues or new_counts):
        return "Phiếu kho mới cần có ít nhất một dòng giao dịch"
    for row in added_ledger:
        date, code, kind, amount, ref = row
        if kind == "Nhập" and ref not in receipt_ids or kind == "Xuất" and ref not in issue_ids or kind == "Kiểm kê" and ref not in count_ids:
            return "Giao dịch mới phải thuộc phiếu nhập, xuất hoặc kiểm kê mới"
        if (kind == "Nhập" and amount <= 0) or (kind == "Xuất" and amount >= 0):
            return "Số lượng nhập/xuất không hợp lệ"
    new_price_by_code = {}
    for row in new_receipts:
        events = [x for x in added_ledger if x[4] == row[0] and x[2] == "Nhập"]
        detail = data.get("doc_details", {}).get(row[0])
        if not isinstance(row[3], int) or row[3] != len(events) or row[3] < 1:
            return "Số dòng của phiếu nhập không khớp với sổ giao dịch"
        if isinstance(row[4], bool) or not isinstance(row[4], (int, float)) or not math.isfinite(row[4]) or row[4] < 0:
            return "Tổng tiền phiếu nhập không hợp lệ"
        if not detail or not isinstance(detail.get("lines"), list):
            return "Phiếu nhập cần lưu chi tiết từng mã, số lượng, đơn giá và nguồn hàng"
        detail_qty = collections.Counter()
        expected_total = 0.0
        supplier_names = []
        for line in detail["lines"]:
            if not line["supplier"]:
                return "Mỗi dòng nhập cần có nhà cung cấp"
            detail_qty[line["code"]] += line["qty"]
            expected_total += line["qty"] * line["unit_price"]
            if line["unit_price"] > 0:
                new_price_by_code[line["code"]] = line["unit_price"]
            if line["supplier"] not in supplier_names:
                supplier_names.append(line["supplier"])
        event_qty = collections.Counter()
        for event in events:
            event_qty[event[1]] += event[3]
        if len(detail["lines"]) != row[3] or detail_qty != event_qty or not math.isclose(row[4], expected_total, rel_tol=1e-9, abs_tol=0.01):
            return "Chi tiết và tổng tiền của phiếu nhập không khớp với sổ kho"
        if row[2] != ", ".join(supplier_names):
            return "Nguồn hàng trên phiếu nhập không khớp với các dòng chi tiết"
    for row in new_issues:
        events = [x for x in added_ledger if x[4] == row[0] and x[2] == "Xuất"]
        detail = data.get("doc_details", {}).get(row[0])
        if not isinstance(row[5], int) or row[5] != len(events) or row[5] < 1:
            return "Số dòng của phiếu xuất không khớp với sổ giao dịch"
        if not detail or len(detail.get("lines", [])) != row[5]:
            return "Phiếu xuất cần lưu chi tiết các dòng nguyên vật liệu"
        detail_qty = collections.Counter()
        for line in detail["lines"]:
            detail_qty[line["code"]] -= line["qty"]
        event_qty = collections.Counter()
        for event in events:
            event_qty[event[1]] += event[3]
        if detail_qty != event_qty:
            return "Chi tiết phiếu xuất không khớp với sổ kho"
    for count in new_counts:
        lines = [x for x in added_ledger if x[4] == count["id"] and x[2] == "Kiểm kê"]
        expected = collections.Counter((line["code"], line["delta"]) for line in count["lines"])
        actual = collections.Counter((line[1], line[3]) for line in lines)
        if len(lines) != len(count["lines"]) or expected != actual:
            return "Các dòng kiểm kê không khớp với sổ giao dịch"

    delta_by_code = collections.defaultdict(float)
    for row in added_ledger:
        delta_by_code[row[1]] += row[3]
    receipt_codes = {row[1] for row in added_ledger if row[2] == "Nhập"}
    for code, before in old_by_code.items():
        after = new_by_code[code]
        if after[:4] != before[:4] or after[5] != before[5] or (after[6] != before[6] and (code not in receipt_codes or not math.isclose(after[6], new_price_by_code.get(code, before[6]), rel_tol=1e-9, abs_tol=1e-6))):
            return "Nhân viên kho không được sửa thông tin hoặc đơn giá danh mục"
        if not math.isclose(after[4], before[4] + delta_by_code[code], rel_tol=1e-9, abs_tol=1e-6):
            return "Tồn kho phải khớp với các phiếu giao dịch mới"
    for order in old_orders:
        new = next((row for row in data["orders"] if row[0] == order[0]), None)
        added_for_order = sum(1 for issue in new_issues if issue[3] == order[0])
        try:
            expected_count = int(float(order[5] or 0)) + added_for_order
            actual_count = int(float(new[5] or 0))
        except (TypeError, ValueError, OverflowError):
            return "Số phiếu xuất liên quan đến đơn hàng không hợp lệ"
        if actual_count != expected_count:
            return "Số phiếu xuất của đơn hàng không khớp"
    return None


def workbook_column(index):
    name = ""
    while index:
        index, rem = divmod(index - 1, 26)
        name = chr(65 + rem) + name
    return name


def order_allowance_error(data):
    """Enforce each order's material plan for every saved issue, regardless of UI client."""
    details = data.get("order_details", {})
    issue_by_id = {row[0]: row for row in data["issues"] if isinstance(row, list) and len(row) == 6 and isinstance(row[0], str)}
    issued = collections.defaultdict(float)
    for event in data["ledger"]:
        if event[2] != "Xuất":
            continue
        issue = issue_by_id.get(event[4])
        if issue and isinstance(issue[3], str) and issue[3] in details:
            issued[(issue[3], event[1])] += abs(float(event[3]))
    for order_id, detail in details.items():
        planned = {line["code"]: float(line["qty"]) for line in detail.get("materials", [])}
        if not planned:
            continue
        multiplier = 1 + float(detail.get("extra_pct", 0)) / 100
        for (linked_order_id, code), quantity in issued.items():
            if linked_order_id != order_id:
                continue
            maximum = planned.get(code)
            if maximum is None:
                return f"Đơn hàng {order_id} chưa khai báo định mức cho mã {code}"
            maximum *= multiplier
            if quantity > maximum + 1e-8:
                return f"Xuất kho vượt định mức đơn {order_id}, mã {code}: tối đa {maximum:g}"
    return None


def workbook_bytes(db):
    materials = [list(r) for r in db.execute("SELECT code,name,category,unit,quantity,minimum,price FROM materials ORDER BY code")]
    receipts = [list(r) for r in db.execute("SELECT id,date,party,line_count,total FROM receipts ORDER BY date DESC,id DESC")]
    issues = [list(r) for r in db.execute("SELECT id,date,party,order_id,kind,line_count FROM issues ORDER BY date DESC,id DESC")]
    names = {r[0]: r[1] for r in materials}
    units = {r[0]: r[3] for r in materials}
    ledger = [list(r) for r in db.execute("SELECT date,material_code,kind,quantity,reference FROM ledger ORDER BY id DESC")]
    sheets = [
        ("Nguyên vật liệu", [["Mã NVL", "Tên nguyên vật liệu", "Nhóm", "ĐVT", "Tồn hiện tại", "Tồn tối thiểu", "Đơn giá gần nhất (₫)", "Giá trị tồn (₫)"]] + [[*row, row[4] * row[6]] for row in materials]),
        ("Phiếu nhập", [["Mã phiếu", "Ngày", "Nhà cung cấp", "Số dòng", "Tổng tiền (₫)"]] + receipts),
        ("Phiếu xuất", [["Mã phiếu", "Ngày", "Khách hàng", "Đơn hàng", "Loại xuất", "Số dòng"]] + issues),
        ("Sổ kho", [["Ngày", "Mã NVL", "Tên NVL", "Loại", "Số lượng", "ĐVT", "Tham chiếu"]] + [[row[0], row[1], names.get(row[1], "NVL đã xóa"), row[2], row[3], units.get(row[1], ""), row[4]] for row in ledger]),
    ]
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rel_ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    pkg_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
    ct_ns = "http://schemas.openxmlformats.org/package/2006/content-types"
    ET.register_namespace("", ns)
    ET.register_namespace("r", rel_ns)
    ET.register_namespace("", pkg_ns)
    ET.register_namespace("", ct_ns)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        types = ET.Element(f"{{{ct_ns}}}Types")
        ET.SubElement(types, f"{{{ct_ns}}}Default", {"Extension": "rels", "ContentType": "application/vnd.openxmlformats-package.relationships+xml"})
        ET.SubElement(types, f"{{{ct_ns}}}Default", {"Extension": "xml", "ContentType": "application/xml"})
        ET.SubElement(types, f"{{{ct_ns}}}Override", {"PartName": "/xl/workbook.xml", "ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"})
        for i in range(1, 5):
            ET.SubElement(types, f"{{{ct_ns}}}Override", {"PartName": f"/xl/worksheets/sheet{i}.xml", "ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"})
        archive.writestr("[Content_Types].xml", ET.tostring(types, encoding="utf-8", xml_declaration=True))
        root_rels = ET.Element(f"{{{pkg_ns}}}Relationships")
        ET.SubElement(root_rels, f"{{{pkg_ns}}}Relationship", {"Id": "rId1", "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "Target": "xl/workbook.xml"})
        archive.writestr("_rels/.rels", ET.tostring(root_rels, encoding="utf-8", xml_declaration=True))
        book = ET.Element(f"{{{ns}}}workbook")
        sheets_el = ET.SubElement(book, f"{{{ns}}}sheets")
        for i, (title, rows) in enumerate(sheets, 1):
            ET.SubElement(sheets_el, f"{{{ns}}}sheet", {"name": title, "sheetId": str(i), f"{{{rel_ns}}}id": f"rId{i}"})
            root = ET.Element(f"{{{ns}}}worksheet")
            data_el = ET.SubElement(root, f"{{{ns}}}sheetData")
            for ri, row in enumerate(rows, 1):
                row_el = ET.SubElement(data_el, f"{{{ns}}}row", {"r": str(ri)})
                for ci, value in enumerate(row, 1):
                    cell = ET.SubElement(row_el, f"{{{ns}}}c", {"r": f"{workbook_column(ci)}{ri}"})
                    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                        cell.set("t", "n")
                        ET.SubElement(cell, f"{{{ns}}}v").text = str(value)
                    else:
                        cell.set("t", "inlineStr")
                        inline = ET.SubElement(cell, f"{{{ns}}}is")
                        text = ET.SubElement(inline, f"{{{ns}}}t")
                        text.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                        text.text = "" if value is None else str(value)
            archive.writestr(f"xl/worksheets/sheet{i}.xml", ET.tostring(root, encoding="utf-8", xml_declaration=True))
        archive.writestr("xl/workbook.xml", ET.tostring(book, encoding="utf-8", xml_declaration=True))
        book_rels = ET.Element(f"{{{pkg_ns}}}Relationships")
        for i in range(1, 5):
            ET.SubElement(book_rels, f"{{{pkg_ns}}}Relationship", {"Id": f"rId{i}", "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet", "Target": f"worksheets/sheet{i}.xml"})
        archive.writestr("xl/_rels/workbook.xml.rels", ET.tostring(book_rels, encoding="utf-8", xml_declaration=True))
    return output.getvalue()


class Handler(BaseHTTPRequestHandler):
    server_version = "HoangNhatSCM/1.0"

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def send_json(self, code, obj, headers=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        if headers:
            for key, value in headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("Content-Length không hợp lệ")
        if length < 0 or length > 6_000_000:
            raise ValueError("Dữ liệu gửi lên quá lớn")
        raw = self.rfile.read(length)
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("Nội dung JSON phải là object")
        return value

    def origin_ok(self):
        origin = self.headers.get("Origin")
        return not origin or urlparse(origin).netloc == self.headers.get("Host")

    def session_user(self, db):
        jar = cookies.SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie", ""))
        except cookies.CookieError:
            return None
        morsel = jar.get(COOKIE_NAME)
        if not morsel:
            return None
        token_hash = hashlib.sha256(morsel.value.encode()).hexdigest()
        row = db.execute("SELECT username, expires_at FROM sessions WHERE token_hash=?", (token_hash,)).fetchone()
        if not row:
            return None
        if row["expires_at"] < int(time.time()):
            db.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))
            return None
        return row["username"]

    def session_role(self, db, username):
        row = db.execute("SELECT role FROM users WHERE username=?", (username,)).fetchone()
        return row["role"] if row else None

    def require_user(self, db):
        user = self.session_user(db)
        if not user:
            self.send_json(401, {"error": "Vui lòng đăng nhập lại"})
        return user

    def require_admin(self, db):
        user = self.require_user(db)
        if user and self.session_role(db, user) != "admin":
            self.send_json(403, {"error": "Chỉ quản trị viên mới được quản lý tài khoản"})
            return None
        return user

    def do_GET(self):
        path = urlparse(self.path).path
        static_assets = {
            "/static/app.css": (BASE / "static" / "app.css", "text/css; charset=utf-8"),
            "/static/app.js": (BASE / "static" / "app.js", "text/javascript; charset=utf-8"),
        }
        if path in static_assets:
            asset_path, content_type = static_assets[path]
            try:
                body = asset_path.read_bytes()
            except OSError:
                return self.send_error(404)
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "same-origin")
            self.end_headers()
            return self.wfile.write(body)
        with connect() as db:
            if path == "/api/health":
                return self.send_json(200, {"ok": True, "database": "postgresql" if os.environ.get("DATABASE_URL") else "sqlite"})
            if path == "/api/auth/status":
                user = self.session_user(db)
                configured = db.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None
                return self.send_json(200, {"configured": configured, "authenticated": bool(user), "username": user, "role": self.session_role(db, user) if user else None, "setup_requires_token": bool(os.environ.get("SETUP_TOKEN"))})
            if path == "/api/users":
                user = self.require_admin(db)
                if not user:
                    return
                rows = [{"username": r[0], "role": r[1], "created_at": r[2]} for r in db.execute("SELECT username,role,created_at FROM users ORDER BY username")]
                return self.send_json(200, {"users": rows})
            if path == "/api/report.xlsx":
                user = self.require_user(db)
                if not user:
                    return
                payload = workbook_bytes(db)
                self.send_response(200)
                self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Content-Disposition", "attachment; filename=hoang-nhat-scm-report.xlsx")
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("X-Frame-Options", "DENY")
                self.end_headers()
                self.wfile.write(payload)
                return
            if path == "/api/state":
                user = self.require_user(db)
                if not user:
                    return
                seed_data(db)
                state = {
                    "materials": [list(r) for r in db.execute("SELECT code,name,category,unit,quantity,minimum,price FROM materials ORDER BY code")],
                    "material_profiles": {r[0]: json.loads(r[1]) for r in db.execute("SELECT code,profile_json FROM material_profiles")},
                    "receipts": [list(r) for r in db.execute("SELECT id,date,party,line_count,total FROM receipts ORDER BY date DESC,id DESC")],
                    "issues": [list(r) for r in db.execute("SELECT id,date,party,order_id,kind,line_count FROM issues ORDER BY date DESC,id DESC")],
                    "orders": [list(r) for r in db.execute("SELECT id,customer,signed_date,product,quantity,issue_count,status FROM orders ORDER BY signed_date DESC,id DESC")],
                    "suppliers": [r[0] for r in db.execute("SELECT name FROM suppliers ORDER BY name")],
                    "supplier_categories": [r[0] for r in db.execute("SELECT name FROM supplier_categories ORDER BY name")],
                    "supplier_profiles": {r[0]: json.loads(r[1]) for r in db.execute("SELECT name,profile_json FROM supplier_profiles")},
                    "supplier_products": {r[0]: json.loads(r[1]) for r in db.execute("SELECT supplier,products_json FROM supplier_products")},
                    "doc_details": {r[0]: json.loads(r[1]) for r in db.execute("SELECT id,detail_json FROM document_details")},
                    "order_details": {r[0]: json.loads(r[1]) for r in db.execute("SELECT id,detail_json FROM order_details")},
                    "customers": [r[0] for r in db.execute("SELECT name FROM customers ORDER BY name")],
                    "ledger": [list(r) for r in db.execute("SELECT date,material_code,kind,quantity,reference FROM ledger ORDER BY id DESC")],
                    "counts": [{"id": r[0], "date": r[1], "note": r[2], "created_by": r[3], "lines": json.loads(r[4])} for r in db.execute("SELECT id,date,note,created_by,lines_json FROM inventory_counts ORDER BY id DESC")],
                }
                version = int(db.execute("SELECT value FROM app_meta WHERE key='version'").fetchone()["value"])
                return self.send_json(200, {"data": state, "username": user, "role": self.session_role(db, user), "version": version})
        if path == "/" or path == "/index.html":
            body = (BASE / "index.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "same-origin")
            self.end_headers()
            return self.wfile.write(body)
        return self.send_error(404)

    def do_POST(self):
        path = urlparse(self.path).path
        if not self.origin_ok():
            return self.send_json(403, {"error": "Yêu cầu không cùng nguồn"})
        try:
            body = self.read_json()
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            return self.send_json(400, {"error": str(exc)})
        with connect() as db:
            if path == "/api/auth/setup":
                db.execute("BEGIN" if os.environ.get("DATABASE_URL") else "BEGIN IMMEDIATE")
                if os.environ.get("DATABASE_URL"):
                    db.execute("LOCK TABLE users IN EXCLUSIVE MODE")
                if db.execute("SELECT 1 FROM users LIMIT 1").fetchone():
                    return self.send_json(409, {"error": "Tài khoản quản trị đã được thiết lập"})
                setup_token = os.environ.get("SETUP_TOKEN", "")
                if setup_token and not hmac.compare_digest(str(body.get("setup_token", "")), setup_token):
                    return self.send_json(403, {"error": "Mã thiết lập không đúng"})
                username = str(body.get("username", "")).strip().lower()
                password = str(body.get("password", ""))
                if not re.fullmatch(r"[a-z0-9._-]{3,60}", username) or len(password) < 12 or len(password) > 200:
                    return self.send_json(400, {"error": "Tên đăng nhập dùng 3–60 ký tự a–z, 0–9, dấu chấm, gạch dưới hoặc gạch ngang; mật khẩu cần ít nhất 12 ký tự"})
                salt = secrets.token_bytes(16)
                db.execute("INSERT INTO users(username,password_salt,password_hash,created_at,role) VALUES(?,?,?,?,?)", (username, salt, password_hash(password, salt), int(time.time()), "admin"))
                seed_data(db)
                token = secrets.token_urlsafe(32)
                db.execute("INSERT INTO sessions VALUES(?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), username, int(time.time()) + SESSION_SECONDS))
                cookie = f"{COOKIE_NAME}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_SECONDS}" + ("; Secure" if os.environ.get("COOKIE_SECURE") == "true" else "")
                return self.send_json(200, {"ok": True, "username": username}, {"Set-Cookie": cookie})
            if path == "/api/auth/login":
                remote = self.client_address[0]
                now = int(time.time())
                with LOGIN_LOCK:
                    recent = [stamp for stamp in LOGIN_FAILURES.get(remote, []) if now - stamp < 900]
                    LOGIN_FAILURES[remote] = recent
                    if len(recent) >= 10:
                        return self.send_json(429, {"error": "Thử đăng nhập quá nhiều lần. Chờ 15 phút rồi thử lại."})
                username = str(body.get("username", "")).strip()
                password = str(body.get("password", ""))
                row = db.execute("SELECT username,password_salt,password_hash,role FROM users WHERE username=?", (username.lower(),)).fetchone()
                if not row or not hmac.compare_digest(password_hash(password, row["password_salt"]), row["password_hash"]):
                    with LOGIN_LOCK:
                        LOGIN_FAILURES[remote] = LOGIN_FAILURES.get(remote, []) + [now]
                    return self.send_json(401, {"error": "Tên đăng nhập hoặc mật khẩu không đúng"})
                with LOGIN_LOCK:
                    LOGIN_FAILURES.pop(remote, None)
                token = secrets.token_urlsafe(32)
                db.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))
                db.execute("INSERT INTO sessions VALUES(?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), row["username"], int(time.time()) + SESSION_SECONDS))
                cookie = f"{COOKIE_NAME}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_SECONDS}" + ("; Secure" if os.environ.get("COOKIE_SECURE") == "true" else "")
                return self.send_json(200, {"ok": True, "username": row["username"], "role": row["role"]}, {"Set-Cookie": cookie})
            if path == "/api/users":
                admin = self.require_admin(db)
                if not admin:
                    return
                username = str(body.get("username", "")).strip().lower()
                password = str(body.get("password", ""))
                role = str(body.get("role", "warehouse"))
                if not re.fullmatch(r"[a-z0-9._-]{3,60}", username) or len(password) < 12 or len(password) > 200 or role not in ("admin", "warehouse"):
                    return self.send_json(400, {"error": "Tên đăng nhập dùng 3–60 ký tự a–z, 0–9, dấu chấm, gạch dưới hoặc gạch ngang; mật khẩu cần ít nhất 12 ký tự và vai trò hợp lệ"})
                salt = secrets.token_bytes(16)
                try:
                    db.execute("INSERT INTO users(username,password_salt,password_hash,created_at,role) VALUES(?,?,?,?,?)", (username, salt, password_hash(password, salt), int(time.time()), role))
                except Exception as exc:
                    db.rollback()
                    if isinstance(exc, sqlite3.IntegrityError) or getattr(exc, "sqlstate", None) == "23505":
                        return self.send_json(409, {"error": "Tên đăng nhập đã tồn tại"})
                    raise
                return self.send_json(201, {"ok": True})
            if path == "/api/auth/password":
                user = self.require_user(db)
                if not user:
                    return
                old_password = str(body.get("current_password", ""))
                new_password = str(body.get("new_password", ""))
                row = db.execute("SELECT password_salt,password_hash FROM users WHERE username=?", (user,)).fetchone()
                if not hmac.compare_digest(password_hash(old_password, row["password_salt"]), row["password_hash"]):
                    return self.send_json(400, {"error": "Mật khẩu hiện tại không đúng"})
                if len(new_password) < 12 or len(new_password) > 200:
                    return self.send_json(400, {"error": "Mật khẩu mới cần ít nhất 12 ký tự"})
                salt = secrets.token_bytes(16)
                db.execute("UPDATE users SET password_salt=?,password_hash=? WHERE username=?", (salt, password_hash(new_password, salt), user))
                db.execute("DELETE FROM sessions WHERE username=?", (user,))
                token = secrets.token_urlsafe(32)
                db.execute("INSERT INTO sessions VALUES(?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), user, int(time.time()) + SESSION_SECONDS))
                cookie = f"{COOKIE_NAME}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_SECONDS}" + ("; Secure" if os.environ.get("COOKIE_SECURE") == "true" else "")
                return self.send_json(200, {"ok": True}, {"Set-Cookie": cookie})
            if path == "/api/auth/logout":
                jar = cookies.SimpleCookie()
                try:
                    jar.load(self.headers.get("Cookie", ""))
                except cookies.CookieError:
                    pass
                morsel = jar.get(COOKIE_NAME)
                if morsel:
                    token_hash = hashlib.sha256(morsel.value.encode()).hexdigest()
                    db.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))
                return self.send_json(200, {"ok": True}, {"Set-Cookie": f"{COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"})
        return self.send_json(404, {"error": "Không tìm thấy API"})

    def do_PUT(self):
        if urlparse(self.path).path != "/api/state":
            return self.send_json(404, {"error": "Không tìm thấy API"})
        if not self.origin_ok():
            return self.send_json(403, {"error": "Yêu cầu không cùng nguồn"})
        try:
            body = self.read_json()
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            return self.send_json(400, {"error": str(exc)})
        data = body.get("data")
        keys = ("materials", "receipts", "issues", "orders", "suppliers", "customers", "ledger")
        if not isinstance(data, dict) or any(not isinstance(data.get(k), list) for k in keys):
            return self.send_json(400, {"error": "Dữ liệu hệ thống không đúng định dạng"})
        counts = data.get("counts", [])
        if not isinstance(counts, list) or len(counts) > 20_000:
            return self.send_json(400, {"error": "Danh sách phiếu kiểm kê không đúng định dạng"})
        seen_count_ids = set()
        for count in counts:
            if not isinstance(count, dict) or set(count) - {"id", "date", "note", "created_by", "lines"}:
                return self.send_json(400, {"error": "Phiếu kiểm kê không đúng định dạng"})
            cid, cdate, note, created_by, lines = (count.get(k) for k in ("id", "date", "note", "created_by", "lines"))
            if not isinstance(cid, str) or not re.fullmatch(r"[A-Za-z0-9._/-]{1,120}", cid) or cid in seen_count_ids or not isinstance(cdate, str) or len(cdate) > 20 or not isinstance(note, str) or len(note) > 1000 or not isinstance(created_by, str) or len(created_by) > 60 or not isinstance(lines, list) or not lines or len(lines) > 20_000:
                return self.send_json(400, {"error": "Thông tin phiếu kiểm kê không hợp lệ"})
            seen_count_ids.add(cid)
            seen_codes = set()
            for line in lines:
                if not isinstance(line, dict) or set(line) != {"code", "before", "counted", "delta"} or not isinstance(line["code"], str) or not line["code"].strip() or line["code"] in seen_codes:
                    return self.send_json(400, {"error": "Dòng kiểm kê không hợp lệ"})
                seen_codes.add(line["code"])
                values = (line["before"], line["counted"], line["delta"])
                if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in values) or line["before"] < 0 or line["counted"] < 0 or not math.isclose(line["counted"] - line["before"], line["delta"], rel_tol=1e-9, abs_tol=1e-6):
                    return self.send_json(400, {"error": "Số liệu kiểm kê không hợp lệ"})
        doc_details = data.get("doc_details", {})
        valid_doc_ids = {row[0] for key in ("receipts", "issues") for row in data[key] if isinstance(row, list) and row and isinstance(row[0], str)}
        if not isinstance(doc_details, dict) or len(doc_details) > 40_000:
            return self.send_json(400, {"error": "Chi tiết chứng từ không đúng định dạng"})
        for doc_id, detail in doc_details.items():
            if not isinstance(doc_id, str) or doc_id not in valid_doc_ids or not isinstance(detail, dict) or set(detail) - {"note", "created_by", "lines", "history"}:
                return self.send_json(400, {"error": "Chi tiết chứng từ không hợp lệ"})
            if not isinstance(detail.get("note", ""), str) or len(detail.get("note", "")) > 2000 or not isinstance(detail.get("created_by", ""), str) or len(detail.get("created_by", "")) > 60 or not isinstance(detail.get("lines", []), list) or len(detail.get("lines", [])) > 20_000 or not isinstance(detail.get("history", []), list) or len(detail.get("history", [])) > 100:
                return self.send_json(400, {"error": "Thông tin chi tiết phiếu không hợp lệ"})
            for line in detail.get("lines", []):
                if not isinstance(line, dict) or set(line) != {"code", "qty", "unit_price", "supplier"} or not isinstance(line["code"], str) or not line["code"].strip() or not isinstance(line["supplier"], str) or len(line["supplier"]) > 160 or any(isinstance(line[k], bool) or not isinstance(line[k], (int, float)) or not math.isfinite(line[k]) or line[k] < 0 for k in ("qty", "unit_price")) or line["qty"] <= 0:
                    return self.send_json(400, {"error": "Dòng chi tiết chứng từ không hợp lệ"})
            for event in detail.get("history", []):
                if not isinstance(event, dict) or set(event) - {"at", "by", "action", "date", "party", "kind", "note", "lines"} or any(not isinstance(event.get(k, ""), str) or len(event.get(k, "")) > 2000 for k in ("at", "by", "action", "date", "party", "kind", "note")) or not isinstance(event.get("lines", []), list):
                    return self.send_json(400, {"error": "Lịch sử chỉnh sửa chứng từ không hợp lệ"})
                for line in event.get("lines", []):
                    if not isinstance(line, dict) or set(line) != {"code", "qty", "unit_price", "supplier"} or not isinstance(line["code"], str) or not isinstance(line["supplier"], str) or any(isinstance(line[k], bool) or not isinstance(line[k], (int, float)) or not math.isfinite(line[k]) or line[k] < 0 for k in ("qty", "unit_price")):
                        return self.send_json(400, {"error": "Lịch sử dòng phiếu không hợp lệ"})
        supplier_categories = data.get("supplier_categories", [])
        if not isinstance(supplier_categories, list) or len(supplier_categories) > 500 or any(not isinstance(x, str) or not x.strip() or len(x) > 80 for x in supplier_categories) or len(set(supplier_categories)) != len(supplier_categories):
            return self.send_json(400, {"error": "Danh mục loại nhà cung cấp không hợp lệ"})
        supplier_profiles = data.get("supplier_profiles", {})
        if not isinstance(supplier_profiles, dict) or len(supplier_profiles) > 1000:
            return self.send_json(400, {"error": "Hồ sơ nhà cung cấp không đúng định dạng"})
        supplier_products = data.get("supplier_products", {})
        if not isinstance(supplier_products, dict) or len(supplier_products) > 1000:
            return self.send_json(400, {"error": "Danh sách sản phẩm nhà cung cấp không đúng định dạng"})
        if any(len(data[k]) > 20_000 for k in keys):
            return self.send_json(400, {"error": "Số dòng vượt giới hạn"})
        if any(not isinstance(row, list) or len(row) != 7 or not isinstance(row[0], str) or not re.fullmatch(r"[A-Za-z0-9._/-]{1,80}", row[0]) or not all(isinstance(value, str) and value.strip() for value in row[1:4]) or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 for value in row[4:7]) for row in data["materials"]):
            return self.send_json(400, {"error": "Mỗi nguyên vật liệu cần đúng 7 cột và mã chỉ gồm chữ, số, dấu . _ / -"})
        if len({row[0] for row in data["materials"]}) != len(data["materials"]):
            return self.send_json(400, {"error": "Mã nguyên vật liệu bị trùng"})
        material_codes = {row[0] for row in data["materials"]}
        material_profiles = data.get("material_profiles", {})
        profile_keys = {"photo", "supplier", "spec", "pack", "color", "size_spec", "lead_time", "moq", "customer", "note"}
        if not isinstance(material_profiles, dict) or len(material_profiles) > 20_000:
            return self.send_json(400, {"error": "Hồ sơ nguyên vật liệu không đúng định dạng"})
        for code, profile in material_profiles.items():
            if code not in material_codes or not isinstance(profile, dict) or set(profile) - profile_keys:
                return self.send_json(400, {"error": "Hồ sơ nguyên vật liệu không hợp lệ"})
            if any(not isinstance(profile.get(key, ""), str) or len(profile.get(key, "")) > 2000 for key in profile_keys):
                return self.send_json(400, {"error": "Hồ sơ nguyên vật liệu không hợp lệ"})
            photo = profile.get("photo", "")
            if photo and (len(photo) > 43_700 or not re.fullmatch(r"data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}", photo)):
                return self.send_json(400, {"error": "Ảnh nguyên vật liệu cần là JPEG, PNG hoặc WebP và không quá 32 KB"})
            supplier = profile.get("supplier", "")
            customer = profile.get("customer", "")
            if supplier and supplier not in data["suppliers"]:
                return self.send_json(400, {"error": "Nhà cung cấp trên hồ sơ NVL không có trong danh bạ"})
            if customer and customer not in data["customers"]:
                return self.send_json(400, {"error": "Khách hàng trên hồ sơ NVL không có trong danh bạ"})
        if any(line["code"] not in material_codes for detail in doc_details.values() for line in detail.get("lines", [])):
            return self.send_json(400, {"error": "Dòng chứng từ tham chiếu mã nguyên vật liệu không tồn tại"})
        order_details = data.get("order_details", {})
        if not isinstance(order_details, dict) or len(order_details) > 20_000:
            return self.send_json(400, {"error": "Định mức đơn hàng không đúng định dạng"})
        order_ids = {row[0] for row in data["orders"] if isinstance(row, list) and row and isinstance(row[0], str)}
        for order_id, detail in order_details.items():
            if not isinstance(order_id, str) or order_id not in order_ids or not isinstance(detail, dict) or set(detail) - {"unit", "extra_pct", "materials", "note", "photo"}:
                return self.send_json(400, {"error": "Chi tiết đơn hàng không hợp lệ"})
            extra_pct, planned = detail.get("extra_pct", 0), detail.get("materials", [])
            if not isinstance(detail.get("unit", ""), str) or len(detail.get("unit", "")) > 40 or not isinstance(detail.get("note", ""), str) or len(detail.get("note", "")) > 2000 or isinstance(extra_pct, bool) or not isinstance(extra_pct, (int, float)) or not math.isfinite(extra_pct) or not 0 <= extra_pct <= 1000 or not isinstance(planned, list) or len(planned) > 1000:
                return self.send_json(400, {"error": "Thông tin hợp đồng hoặc tỷ lệ xuất dư không hợp lệ"})
            seen_planned = set()
            for line in planned:
                if not isinstance(line, dict) or set(line) != {"code", "qty"} or not isinstance(line["code"], str) or line["code"] not in material_codes or line["code"] in seen_planned or isinstance(line["qty"], bool) or not isinstance(line["qty"], (int, float)) or not math.isfinite(line["qty"]) or line["qty"] <= 0:
                    return self.send_json(400, {"error": "Định mức NVL phải là mã hợp lệ và số lượng lớn hơn 0"})
                seen_planned.add(line["code"])
            photo = detail.get("photo", "")
            if not isinstance(photo, str) or len(photo) > 43_700 or (photo and not re.fullmatch(r"data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}", photo)):
                return self.send_json(400, {"error": "Ảnh sản phẩm cần là JPEG, PNG hoặc WebP và không quá 32 KB"})
        for name, width in (("receipts", 5), ("issues", 6), ("orders", 7), ("ledger", 5)):
            if any(not isinstance(row, list) or len(row) != width for row in data[name]):
                return self.send_json(400, {"error": f"Dữ liệu {name} không đúng số cột"})
        valid_doc_ids = {row[0] for key in ("receipts", "issues") for row in data[key] if isinstance(row[0], str)}
        if any(not isinstance(value, str) or not value.strip() or len(value) > 160 for value in data["suppliers"] + data["customers"]):
            return self.send_json(400, {"error": "Danh bạ phải là danh sách tên dạng văn bản"})
        for supplier, products in supplier_products.items():
            if supplier not in data["suppliers"] or not isinstance(products, list) or len(products) > 500:
                return self.send_json(400, {"error": "Sản phẩm phải thuộc một nhà cung cấp và không vượt 500 dòng"})
            for product in products:
                if not isinstance(product, dict) or set(product) - {"id", "name", "unit", "price", "note", "photo"} or any(not isinstance(product.get(k, ""), str) for k in ("id", "name", "unit", "note", "photo")) or not product.get("id", "").strip() or not product.get("name", "").strip() or len(product.get("id", "")) > 120 or len(product.get("name", "")) > 160 or len(product.get("unit", "")) > 40 or len(product.get("note", "")) > 1000 or isinstance(product.get("price", 0), bool) or not isinstance(product.get("price", 0), (int, float)) or not math.isfinite(product.get("price", 0)) or product.get("price", 0) < 0:
                    return self.send_json(400, {"error": "Thông tin sản phẩm nhà cung cấp không hợp lệ"})
                photo = product.get("photo", "")
                if photo and (len(photo) > 43_700 or not re.fullmatch(r"data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}", photo)):
                    return self.send_json(400, {"error": "Ảnh sản phẩm cần là JPEG, PNG hoặc WebP và không quá 32 KB"})
        profile_fields = {"logo", "short_code", "products", "categories", "phone", "messenger", "address", "source", "currency", "foreign_price", "exchange_rate", "delivery_days", "note"}
        if any(name not in data["suppliers"] or not isinstance(profile, dict) or set(profile) - profile_fields or any(not isinstance(value, str) or len(value) > 1200 for value in profile.values()) for name, profile in supplier_profiles.items()):
            return self.send_json(400, {"error": "Thông tin hồ sơ nhà cung cấp không hợp lệ"})
        for profile in supplier_profiles.values():
            logo = profile.get("logo", "")
            if logo and (len(logo) > 43_700 or not re.fullmatch(r"data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}", logo)):
                return self.send_json(400, {"error": "Ảnh nhà cung cấp cần là JPEG, PNG hoặc WebP và không quá 32 KB"})
        if sum(len(profile.get("logo", "")) for profile in supplier_profiles.values()) > 4_000_000:
            return self.send_json(400, {"error": "Tổng dung lượng ảnh nhà cung cấp vượt giới hạn lưu trữ 4 MB"})
        stored_image_size = sum(len(profile.get("logo", "")) for profile in supplier_profiles.values())
        stored_image_size += sum(len(product.get("photo", "")) for products in supplier_products.values() for product in products)
        stored_image_size += sum(len(detail.get("photo", "")) for detail in order_details.values())
        stored_image_size += sum(len(profile.get("photo", "")) for profile in material_profiles.values())
        if stored_image_size > 8_000_000:
            return self.send_json(400, {"error": "Tổng dung lượng ảnh hồ sơ, sản phẩm và đơn hàng vượt giới hạn 8 MB"})
        if any(not all(isinstance(value, str) for value in row[:3]) or row[2] not in ("Nhập", "Xuất", "Kiểm kê") or isinstance(row[3], bool) or not isinstance(row[3], (int, float)) or not math.isfinite(row[3]) or not isinstance(row[4], str) for row in data["ledger"]):
            return self.send_json(400, {"error": "Dòng sổ kho có dữ liệu không hợp lệ"})
        allowance_error = order_allowance_error(data)
        if allowance_error:
            return self.send_json(400, {"error": allowance_error})
        with connect() as db:
            try:
                db.execute("BEGIN IMMEDIATE")
                user = self.require_user(db)
                if not user:
                    db.rollback()
                    return
                version_query = "SELECT value FROM app_meta WHERE key='version' FOR UPDATE" if os.environ.get("DATABASE_URL") else "SELECT value FROM app_meta WHERE key='version'"
                current = int(db.execute(version_query).fetchone()["value"])
                if body.get("version") != current:
                    db.rollback()
                    return self.send_json(409, {"error": "Dữ liệu vừa được người khác cập nhật. Hãy tải lại trang trước khi lưu.", "version": current})
                if self.session_role(db, user) != "admin":
                    error = warehouse_change_error(db, data)
                    if error:
                        db.rollback()
                        return self.send_json(403, {"error": error})
                db.execute("INSERT INTO app_meta(key,value) VALUES('seeded','1') ON CONFLICT(key) DO UPDATE SET value='1'")
                for table in ("materials", "material_profiles", "receipts", "issues", "orders", "supplier_products", "supplier_profiles", "document_details", "order_details", "supplier_categories", "suppliers", "customers", "ledger", "inventory_counts"):
                    db.execute(f"DELETE FROM {table}")
                db.executemany("INSERT INTO materials VALUES(?,?,?,?,?,?,?)", data["materials"])
                db.executemany("INSERT INTO material_profiles(code,profile_json) VALUES(?,?)", [[code, json.dumps(profile, ensure_ascii=False)] for code, profile in material_profiles.items()])
                db.executemany("INSERT INTO receipts VALUES(?,?,?,?,?)", data["receipts"])
                db.executemany("INSERT INTO issues VALUES(?,?,?,?,?,?)", data["issues"])
                db.executemany("INSERT INTO orders VALUES(?,?,?,?,?,?,?)", data["orders"])
                db.executemany("INSERT INTO suppliers VALUES(?)", [[x] for x in data["suppliers"]])
                db.executemany("INSERT INTO supplier_categories VALUES(?)", [[x] for x in supplier_categories])
                db.executemany("INSERT INTO supplier_profiles(name,profile_json) VALUES(?,?)", [[name, json.dumps(profile, ensure_ascii=False)] for name, profile in supplier_profiles.items()])
                db.executemany("INSERT INTO supplier_products(supplier,products_json) VALUES(?,?)", [[name, json.dumps(products, ensure_ascii=False)] for name, products in supplier_products.items()])
                db.executemany("INSERT INTO document_details(id,detail_json) VALUES(?,?)", [[doc_id, json.dumps(detail, ensure_ascii=False)] for doc_id, detail in doc_details.items()])
                db.executemany("INSERT INTO order_details(id,detail_json) VALUES(?,?)", [[order_id, json.dumps(detail, ensure_ascii=False)] for order_id, detail in order_details.items()])
                db.executemany("INSERT INTO customers VALUES(?)", [[x] for x in data["customers"]])
                db.executemany("INSERT INTO ledger(date,material_code,kind,quantity,reference) VALUES(?,?,?,?,?)", data["ledger"][::-1])
                db.executemany("INSERT INTO inventory_counts(id,date,note,created_by,lines_json) VALUES(?,?,?,?,?)", [[c["id"], c["date"], c["note"], c["created_by"], json.dumps(c["lines"], ensure_ascii=False)] for c in counts[::-1]])
                db.execute("UPDATE app_meta SET value=? WHERE key='version'", (str(current + 1),))
                db.commit()
            except Exception as exc:
                db.rollback()
                return self.send_json(400, {"error": f"Không lưu được dữ liệu: {exc}"})
        return self.send_json(200, {"ok": True, "version": current + 1})

    def do_DELETE(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/users/") or not self.origin_ok():
            return self.send_json(404, {"error": "Không tìm thấy API"})
        username = path.removeprefix("/api/users/").strip().lower()
        with connect() as db:
            admin = self.require_admin(db)
            if not admin:
                return
            target = db.execute("SELECT role FROM users WHERE username=?", (username,)).fetchone()
            if not target:
                return self.send_json(404, {"error": "Không tìm thấy tài khoản"})
            if target["role"] == "admin" and db.execute("SELECT COUNT(*) AS n FROM users WHERE role='admin'").fetchone()["n"] <= 1:
                return self.send_json(409, {"error": "Không thể xóa tài khoản quản trị viên cuối cùng"})
            db.execute("DELETE FROM users WHERE username=?", (username,))
        return self.send_json(200, {"ok": True})

    def do_OPTIONS(self):
        return self.send_json(204, {})


if __name__ == "__main__":
    initialize()
    host = os.environ.get("SCM_HOST", "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1")
    port = int(os.environ.get("PORT", os.environ.get("SCM_PORT", "4173")))
    print(f"SCM listening on http://{host}:{port}")
    print("Database: PostgreSQL" if os.environ.get("DATABASE_URL") else f"SQLite database: {Path(os.environ.get('SCM_DB_PATH', DB_PATH))}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()
