import http.cookiejar
import io
import json
import os
import tempfile
import zipfile
import xml.etree.ElementTree as ET
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import server


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_db = os.environ.get("SCM_DB_PATH")
        self.old_setup = os.environ.get("SETUP_TOKEN")
        self.old_url = os.environ.get("DATABASE_URL")
        os.environ.pop("DATABASE_URL", None)
        os.environ.pop("SETUP_TOKEN", None)
        os.environ["SCM_DB_PATH"] = str(Path(self.temp.name) / "test.sqlite3")
        server.initialize()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.httpd.server_port}"
        self.owner = self.client()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        self.temp.cleanup()
        for key, value in (("SCM_DB_PATH", self.old_db), ("SETUP_TOKEN", self.old_setup), ("DATABASE_URL", self.old_url)):
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def client(self):
        jar = http.cookiejar.CookieJar()
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def call(self, client, method, path, data=None, expected=None):
        raw = None if data is None else json.dumps(data).encode()
        req = urllib.request.Request(self.base + path, data=raw, method=method, headers={"Content-Type": "application/json"})
        try:
            with client.open(req, timeout=5) as response:
                code, body = response.status, response.read()
        except urllib.error.HTTPError as exc:
            code, body = exc.code, exc.read()
            exc.close()
        if expected is not None:
            self.assertEqual(code, expected, body.decode("utf-8", "replace"))
        return code, json.loads(body) if body else {}

    def test_login_seed_state_and_persistence(self):
        self.call(self.owner, "GET", "/api/auth/status", expected=200)
        self.call(self.owner, "GET", "/api/state", expected=401)
        self.call(self.owner, "POST", "/api/auth/setup", {"username": "owner", "password": "correct-horse-battery"}, 200)
        _, response = self.call(self.owner, "GET", "/api/state", expected=200)
        self.assertEqual(len(response["data"]["materials"]), 0)
        self.assertEqual(response["version"], 0)
        state = response["data"]
        state["materials"] = [["TEST-1", "Test material", "Khác", "Cái", 100, 5, 10]]
        state["ledger"] = [["13/10/2026", "TEST-1", "Kiểm kê", 3, "newest"], ["12/10/2026", "TEST-1", "Nhập", 2, "middle"], ["11/10/2026", "TEST-1", "Xuất", -1, "oldest"]]
        state["suppliers"] = ["Nhà cung cấp thử"]
        state["supplier_profiles"] = {"Nhà cung cấp thử": {"short_code": "NCC-THU", "categories": "NCC vải", "logo": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/63sAAAAASUVORK5CYII="}}
        state["supplier_products"] = {"Nhà cung cấp thử": [{"id": "SP-1", "name": "Mẫu vải xanh", "unit": "mét", "price": 120, "note": "Khổ 1,5 m", "photo": ""}]}
        state["customers"] = ["Khách hàng thử"]
        state["orders"] = [["DH-1", "Khách hàng thử", "13/10/2026", "Áo mẫu", "20", "0", "Đang thực hiện"]]
        state["order_details"] = {"DH-1": {"unit": "túi", "extra_pct": 5, "materials": [{"code": "TEST-1", "qty": 2}], "note": "Đơn kiểm tra", "photo": ""}}
        code, _ = self.call(self.owner, "PUT", "/api/state", {"data": state, "version": 0}, 200)
        self.assertEqual(code, 200)
        _, saved = self.call(self.owner, "GET", "/api/state", expected=200)
        self.assertEqual(saved["version"], 1)
        saved["data"]["materials"][0][4] = 101
        self.call(self.owner, "PUT", "/api/state", {"data": saved["data"], "version": saved["version"]}, 200)
        _, saved = self.call(self.owner, "GET", "/api/state", expected=200)
        self.assertEqual(saved["data"]["materials"][0][4], 101)
        self.assertEqual([row[4] for row in saved["data"]["ledger"]], ["newest", "middle", "oldest"])
        self.assertEqual(saved["data"]["supplier_profiles"]["Nhà cung cấp thử"]["short_code"], "NCC-THU")
        self.assertEqual(saved["data"]["supplier_profiles"]["Nhà cung cấp thử"]["logo"], state["supplier_profiles"]["Nhà cung cấp thử"]["logo"])
        self.assertEqual(saved["data"]["supplier_products"]["Nhà cung cấp thử"][0]["name"], "Mẫu vải xanh")
        self.assertEqual(saved["data"]["order_details"]["DH-1"]["materials"][0]["qty"], 2)
        self.assertEqual(saved["version"], 2)

    def test_staff_role_and_stale_write_conflict(self):
        self.call(self.owner, "POST", "/api/auth/setup", {"username": "owner", "password": "correct-horse-battery"}, 200)
        second_owner = self.client()
        self.call(second_owner, "POST", "/api/auth/login", {"username": "owner", "password": "correct-horse-battery"}, 200)
        self.call(self.owner, "POST", "/api/users", {"username": "worker", "password": "another-safe-password", "role": "warehouse"}, 201)
        worker = self.client()
        self.call(worker, "POST", "/api/auth/login", {"username": "worker", "password": "another-safe-password"}, 200)
        self.call(worker, "GET", "/api/users", expected=403)
        self.call(self.owner, "GET", "/api/users", expected=200)
        _, old = self.call(self.owner, "GET", "/api/state", expected=200)
        old["data"]["materials"] = [["TEST-1", "Test material", "Khác", "Cái", 100, 5, 10]]
        old["data"]["suppliers"] = ["NCC thử"]
        old["data"]["supplier_products"] = {"NCC thử": [{"id": "SP-1", "name": "Mẫu", "unit": "mét", "price": 1, "note": "", "photo": ""}]}
        old["data"]["customers"] = ["Khách hàng thử"]
        old["data"]["orders"] = [["DH-OLD", "Khách hàng thử", "12/10/2026", "Áo", "10", "0", "Đang thực hiện"]]
        old["data"]["order_details"] = {"DH-OLD": {"unit": "túi", "extra_pct": 0, "materials": [{"code": "TEST-1", "qty": 5}], "note": "", "photo": ""}}
        self.call(self.owner, "PUT", "/api/state", {"data": old["data"], "version": old["version"]}, 200)
        _, old = self.call(self.owner, "GET", "/api/state", expected=200)
        _, current = self.call(second_owner, "GET", "/api/state", expected=200)
        old["data"]["materials"][0][4] = 103
        current["data"]["materials"][0][4] = 104
        self.call(self.owner, "PUT", "/api/state", {"data": old["data"], "version": old["version"]}, 200)
        self.call(second_owner, "PUT", "/api/state", {"data": current["data"], "version": current["version"]}, 409)
        self.call(self.owner, "DELETE", "/api/users/owner", expected=409)
        _, staff_state = self.call(worker, "GET", "/api/state", expected=200)
        staff_state["data"]["supplier_products"]["NCC thử"][0]["price"] = 2
        self.call(worker, "PUT", "/api/state", {"data": staff_state["data"], "version": staff_state["version"]}, 403)
        _, staff_state = self.call(worker, "GET", "/api/state", expected=200)
        staff_state["data"]["order_details"]["DH-OLD"]["materials"][0]["qty"] = 6
        self.call(worker, "PUT", "/api/state", {"data": staff_state["data"], "version": staff_state["version"]}, 403)
        _, staff_state = self.call(worker, "GET", "/api/state", expected=200)
        staff_state["data"]["materials"][0][4] += 1
        staff_state["data"]["materials"][0][6] = 100
        staff_state["data"]["receipts"].insert(0, ["PNK-STAFF-1", "13/10/2026", "NCC thử", 1, 100])
        staff_state["data"]["doc_details"]["PNK-STAFF-1"] = {"note": "", "created_by": "worker", "lines": [{"code": "TEST-1", "qty": 1, "unit_price": 100, "supplier": "NCC thử"}], "history": []}
        staff_state["data"]["ledger"].insert(0, ["13/10/2026", "TEST-1", "Nhập", 1, "PNK-STAFF-1"])
        self.call(worker, "PUT", "/api/state", {"data": staff_state["data"], "version": staff_state["version"]}, 200)
        _, staff_state = self.call(worker, "GET", "/api/state", expected=200)
        staff_state["data"]["materials"][0][1] = "Edited by staff"
        self.call(worker, "PUT", "/api/state", {"data": staff_state["data"], "version": staff_state["version"]}, 403)

    def test_inventory_count_document_roundtrip_and_validation(self):
        self.call(self.owner, "POST", "/api/auth/setup", {"username": "owner", "password": "correct-horse-battery"}, 200)
        _, state = self.call(self.owner, "GET", "/api/state", expected=200)
        state["data"]["materials"] = [["TEST-1", "Test material", "Khác", "Cái", 8, 0, 10]]
        state["data"]["ledger"] = [["13/10/2026", "TEST-1", "Kiểm kê", -2, "KK-TEST-1"]]
        state["data"]["counts"] = [{"id": "KK-TEST-1", "date": "13/10/2026", "note": "Kiểm đầu ca", "created_by": "owner", "lines": [{"code": "TEST-1", "before": 10, "counted": 8, "delta": -2}]}]
        self.call(self.owner, "PUT", "/api/state", {"data": state["data"], "version": state["version"]}, 200)
        _, saved = self.call(self.owner, "GET", "/api/state", expected=200)
        self.assertEqual(saved["data"]["counts"][0]["id"], "KK-TEST-1")
        self.assertEqual(saved["data"]["counts"][0]["lines"][0]["counted"], 8)
        saved["data"]["counts"][0]["lines"][0]["delta"] = -1
        self.call(self.owner, "PUT", "/api/state", {"data": saved["data"], "version": saved["version"]}, 400)

    def test_excel_report_is_authenticated_and_contains_four_sheets(self):
        self.call(self.owner, "POST", "/api/auth/setup", {"username": "owner", "password": "correct-horse-battery"}, 200)
        _, state = self.call(self.owner, "GET", "/api/state", expected=200)
        state["data"]["materials"] = [["TEST-1", "Test material", "Khác", "Cái", 3, 1, 12]]
        self.call(self.owner, "PUT", "/api/state", {"data": state["data"], "version": state["version"]}, 200)
        request = urllib.request.Request(self.base + "/api/report.xlsx", method="GET")
        with self.owner.open(request, timeout=5) as response:
            content = response.read()
            self.assertEqual(response.headers.get_content_type(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            workbook = ET.fromstring(archive.read("xl/workbook.xml"))
            ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            names = [node.attrib["name"] for node in workbook.findall(".//x:sheet", ns)]
            self.assertEqual(names, ["Nguyên vật liệu", "Phiếu nhập", "Phiếu xuất", "Sổ kho"])
            inventory_xml = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
            self.assertGreater(len(inventory_xml.findall(".//x:row", ns)), 1)
        anonymous = self.client()
        req = urllib.request.Request(self.base + "/api/report.xlsx", method="GET")
        try:
            anonymous.open(req, timeout=5)
            self.fail("unauthenticated workbook download should fail")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 401)

    def test_order_material_allowance_is_enforced_by_backend(self):
        self.call(self.owner, "POST", "/api/auth/setup", {"username": "owner", "password": "correct-horse-battery"}, 200)
        _, state = self.call(self.owner, "GET", "/api/state", expected=200)
        state["data"]["materials"] = [["TEST-1", "Test material", "Khác", "Cái", 2.7, 0, 10]]
        state["data"]["customers"] = ["Khách hàng thử"]
        state["data"]["orders"] = [["DH-1", "Khách hàng thử", "13/10/2026", "Áo", "10", "1", "Đang thực hiện"]]
        state["data"]["order_details"] = {"DH-1": {"unit": "túi", "extra_pct": 10, "materials": [{"code": "TEST-1", "qty": 2}], "note": "", "photo": ""}}
        state["data"]["issues"] = [["PXK-1", "13/10/2026", "Khách hàng thử", "DH-1", "Xuất gia công", 1]]
        state["data"]["ledger"] = [["13/10/2026", "TEST-1", "Xuất", -2.3, "PXK-1"]]
        state["data"]["doc_details"] = {"PXK-1": {"note": "", "created_by": "owner", "lines": [{"code": "TEST-1", "qty": 2.3, "unit_price": 0, "supplier": ""}], "history": []}}
        self.call(self.owner, "PUT", "/api/state", {"data": state["data"], "version": state["version"]}, 400)
        state["data"]["materials"][0][4] = 2.8
        state["data"]["ledger"][0][3] = -2.2
        state["data"]["doc_details"]["PXK-1"]["lines"][0]["qty"] = 2.2
        self.call(self.owner, "PUT", "/api/state", {"data": state["data"], "version": state["version"]}, 200)
        _, saved = self.call(self.owner, "GET", "/api/state", expected=200)
        self.assertEqual(saved["data"]["ledger"][0][3], -2.2)

    def test_document_line_details_and_edit_history_roundtrip(self):
        self.call(self.owner, "POST", "/api/auth/setup", {"username": "owner", "password": "correct-horse-battery"}, 200)
        _, state = self.call(self.owner, "GET", "/api/state", expected=200)
        state["data"]["materials"] = [["TEST-1", "Test material", "Khác", "Cái", 4, 0, 25]]
        state["data"]["suppliers"] = ["NCC thử"]
        state["data"]["receipts"] = [["PNK-1", "13/10/2026", "NCC thử", 1, 100]]
        state["data"]["doc_details"] = {"PNK-1": {"note": "Giao đủ", "created_by": "owner", "lines": [{"code": "TEST-1", "qty": 4, "unit_price": 25, "supplier": "NCC thử"}], "history": [{"at": "2026-10-13T04:00:00Z", "by": "owner", "action": "Sửa phiếu", "date": "12/10/2026", "party": "NCC thử", "kind": "Nhập", "note": "Cũ", "lines": [{"code": "TEST-1", "qty": 2, "unit_price": 25, "supplier": "NCC thử"}]}]}}
        self.call(self.owner, "PUT", "/api/state", {"data": state["data"], "version": state["version"]}, 200)
        _, saved = self.call(self.owner, "GET", "/api/state", expected=200)
        self.assertEqual(saved["data"]["doc_details"]["PNK-1"]["lines"][0]["qty"], 4)
        self.assertEqual(saved["data"]["doc_details"]["PNK-1"]["history"][0]["note"], "Cũ")
        saved["data"]["doc_details"]["PNK-1"]["lines"][0]["qty"] = -1
        self.call(self.owner, "PUT", "/api/state", {"data": saved["data"], "version": saved["version"]}, 400)

    def test_setup_token_and_bad_login(self):
        os.environ["SETUP_TOKEN"] = "one-time-enrollment-key"
        self.call(self.owner, "POST", "/api/auth/setup", {"username": "owner", "password": "correct-horse-battery"}, 403)
        self.call(self.owner, "POST", "/api/auth/setup", {"username": "owner", "password": "correct-horse-battery", "setup_token": "one-time-enrollment-key"}, 200)
        wrong = self.client()
        self.call(wrong, "POST", "/api/auth/login", {"username": "owner", "password": "wrong-password"}, 401)
        self.call(wrong, "GET", "/api/state", expected=401)

    def test_rejects_unsafe_codes_and_usernames(self):
        self.call(self.owner, "POST", "/api/auth/setup", {"username": "owner", "password": "correct-horse-battery"}, 200)
        self.call(self.owner, "POST", "/api/users", {"username": "bad'name", "password": "another-safe-password", "role": "warehouse"}, 400)
        _, current = self.call(self.owner, "GET", "/api/state", expected=200)
        current["data"]["materials"] = [["bad');alert(1)", "Invalid", "Khác", "Cái", 0, 0, 0]]
        self.call(self.owner, "PUT", "/api/state", {"data": current["data"], "version": current["version"]}, 400)
        _, saved = self.call(self.owner, "GET", "/api/state", expected=200)
        self.assertEqual(saved["data"]["materials"], [])

    def test_rejects_unsafe_supplier_profile_images(self):
        self.call(self.owner, "POST", "/api/auth/setup", {"username": "owner", "password": "correct-horse-battery"}, 200)
        _, current = self.call(self.owner, "GET", "/api/state", expected=200)
        current["data"]["suppliers"] = ["Nhà cung cấp thử"]
        current["data"]["supplier_profiles"] = {"Nhà cung cấp thử": {"logo": "https://untrusted.example/image.svg"}}
        self.call(self.owner, "PUT", "/api/state", {"data": current["data"], "version": current["version"]}, 400)


if __name__ == "__main__":
    unittest.main()
