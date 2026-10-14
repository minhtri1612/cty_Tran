function passwordModal() {
  openModal(
    "Đổi mật khẩu",
    `<div class="form-grid"><div class="form-field full"><label>Mật khẩu hiện tại</label><input id="currentPassword" type="password" autocomplete="current-password"></div><div class="form-field full"><label>Mật khẩu mới (ít nhất 12 ký tự)</label><input id="newPassword" type="password" minlength="12" autocomplete="new-password"></div><div class="form-field full"><label>Nhập lại mật khẩu mới</label><input id="confirmPassword" type="password" minlength="12" autocomplete="new-password"></div></div>`,
    async () => {
      const current_password = document.getElementById("currentPassword").value,
        new_password = document.getElementById("newPassword").value;
      if (new_password.length < 12)
        return toast("Mật khẩu mới cần ít nhất 12 ký tự");
      if (new_password !== document.getElementById("confirmPassword").value)
        return toast("Mật khẩu mới chưa khớp");
      try {
        const r = await fetch("/api/auth/password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_password, new_password }),
          }),
          j = await r.json();
        if (!r.ok) return toast(j.error || "Không đổi được mật khẩu");
        closeModal();
        toast("Đã đổi mật khẩu");
      } catch (e) {
        toast("Không kết nối được máy chủ");
      }
    },
  );
}
async function loadUsers() {
  const box = document.getElementById("userList");
  if (!box) return;
  try {
    const r = await fetch("/api/users", { cache: "no-store" }),
      j = await r.json();
    if (!r.ok) throw Error(j.error || "Không tải được tài khoản");
    box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>TÊN ĐĂNG NHẬP</th><th>VAI TRÒ</th><th>NGÀY TẠO</th><th></th></tr></thead><tbody>${j.users.map((u) => `<tr><td class="primary-text">${esc(u.username)}</td><td>${u.role === "admin" ? "Quản trị viên" : "Nhân viên kho"}</td><td>${new Date(u.created_at * 1000).toLocaleDateString("vi-VN")}</td><td>${u.username === currentUser ? "" : `<button class="link-button" onclick="deleteUser('${esc(u.username)}')">Xóa</button>`}</td></tr>`).join("")}</tbody></table></div>`;
  } catch (e) {
    box.innerHTML = `<span class="subtle">${esc(e.message || "Không tải được tài khoản")}</span>`;
  }
}
function userModal() {
  openModal(
    "Tạo tài khoản nội bộ",
    `<div class="form-grid"><div class="form-field"><label>Tên đăng nhập</label><input id="newUserName" required minlength="3" maxlength="60" pattern="[a-zA-Z0-9._-]+" autocomplete="off" placeholder="chỉ chữ, số, . _ -"></div><div class="form-field"><label>Vai trò</label><select id="newUserRole"><option value="warehouse">Nhân viên kho</option><option value="admin">Quản trị viên</option></select></div><div class="form-field full"><label>Mật khẩu tạm thời (ít nhất 12 ký tự)</label><input id="newUserPassword" type="password" minlength="12" maxlength="200" autocomplete="new-password"></div></div>`,
    async () => {
      const username = document.getElementById("newUserName").value.trim(),
        password = document.getElementById("newUserPassword").value,
        role = document.getElementById("newUserRole").value;
      if (!/^[a-zA-Z0-9._-]{3,60}$/.test(username))
        return toast("Tên đăng nhập dùng 3–60 ký tự chữ, số, . _ -");
      if (password.length < 12) return toast("Mật khẩu cần ít nhất 12 ký tự");
      try {
        const r = await fetch("/api/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, role }),
          }),
          j = await r.json();
        if (!r.ok) return toast(j.error || "Không tạo được tài khoản");
        closeModal();
        await loadUsers();
        toast("Đã tạo tài khoản");
      } catch (e) {
        toast("Không kết nối được máy chủ");
      }
    },
  );
}
async function deleteUser(username) {
  if (!confirm(`Xóa tài khoản ${username}?`)) return;
  try {
    const r = await fetch("/api/users/" + encodeURIComponent(username), {
        method: "DELETE",
      }),
      j = await r.json();
    if (!r.ok) return toast(j.error || "Không xóa được tài khoản");
    await loadUsers();
    toast("Đã xóa tài khoản");
  } catch (e) {
    toast("Không kết nối được máy chủ");
  }
}
function viewSettings() {
  const noPrice = data.materials.filter((m) => Number(m[6] || 0) <= 0),
    missingSource = data.receipts.filter(
      (r) => !r[2] || r[2] === "—" || !data.suppliers.includes(r[2]),
    ),
    incompleteSuppliers = data.suppliers.filter(
      (n) => !n.trim() || !(data.supplier_profiles[n]?.short_code || "").trim(),
    );
  const issue = (label, items, pageName, tip) =>
    `<div class="quality-row"><div><b>${esc(label)}</b><small>${esc(tip)}</small></div><span class="pill ${items.length ? "warn" : ""}">${items.length}</span><button class="btn small" onclick="go('${pageName}')">${items.length ? "Mở để sửa" : "Mở danh sách"}</button></div>`;
  return `${head("Cài đặt", "Xuất báo cáo, kiểm tra chất lượng dữ liệu và quản lý tài khoản nội bộ.")}<div class="grid settings-grid"><section class="card setting"><h3>Xuất báo cáo Excel</h3><p>Kết xuất dữ liệu hiện tại ra một file Excel gồm 4 sheet. Giá trị tồn được tính lại lúc xuất.</p><button class="btn primary" onclick="exportReportXlsx()">⇩ Tải file Excel</button></section><section class="card setting"><h3>Nhập / xuất danh mục kho</h3><p>Nhập danh mục và tồn đầu kỳ từ CSV. Hãy sao lưu dữ liệu hiện tại và kiểm tra mã trùng trước khi thay tồn.</p><button class="btn" onclick="downloadImportTemplate()">⇩ Tải mẫu CSV</button> <button class="btn primary" id="materialImport" onclick="document.getElementById('materialCsv').click()">Nhập danh mục</button><input id="materialCsv" type="file" accept=".csv,text/csv" hidden onchange="importMaterialsCSV(this)"><button class="btn" onclick="exportCSV()">Xuất danh sách NVL</button></section><section class="card setting" style="grid-column:1/-1"><h3>Chất lượng dữ liệu</h3><p>Phát hiện dữ liệu cần rà lại và mở đúng màn hình để sửa.</p>${issue("Dòng nhập thiếu nguồn hàng", missingSource, "receipts", "Phiếu nhập không có nhà cung cấp trong danh bạ.")}${issue("NVL chưa có đơn giá", noPrice, "materials", "Giá nhập gần nhất đang trống hoặc bằng 0.")}${issue("Nhà cung cấp thiếu mã viết tắt", incompleteSuppliers, "suppliers", "Bổ sung mã viết tắt để tra cứu nhanh.")}</section><section class="card setting"><h3>Giá vốn theo lô (FIFO)</h3><p>Chưa được bật trong bản local. Hiện hệ thống lưu giá nhập gần nhất, chưa có giá từng dòng/lô để tính giá vốn xuất chính xác. Cần bổ sung chi tiết dòng phiếu và đối chiếu tồn trước khi dùng giá vốn theo lô.</p><span class="pill warn">Chưa sẵn sàng</span></section><section class="card setting"><h3>Phân quyền hiện có</h3><p>Quản trị viên quản lý danh mục, danh bạ, tài khoản và dữ liệu. Nhân viên kho chỉ tạo phiếu giao dịch mới, kiểm kê, và theo dõi đơn; backend từ chối sửa/xóa giao dịch cũ hoặc danh mục.</p><span class="pill blue">2 vai trò · kiểm tra tại máy chủ</span></section><section class="card setting"><h3>Mã PIN thẻ nhân viên</h3><p>Đăng nhập hiện hỗ trợ tên đăng nhập và mật khẩu. Chưa triển khai đăng nhập bằng thẻ/PIN.</p><span class="pill warn">Chưa triển khai</span></section><section class="card setting"><h3>Bảo mật tài khoản</h3><p>Đổi mật khẩu tài khoản đang đăng nhập. Mỗi nhân viên có tài khoản riêng; phiên làm việc tự hết hạn sau 12 giờ.</p><button class="btn" onclick="passwordModal()">Đổi mật khẩu</button></section><section class="card setting" id="userManagement" style="grid-column:1/-1"><h3>Tài khoản nội bộ</h3><p>Tạo tài khoản riêng cho nhân viên. Quản trị viên có thể thu hồi tài khoản.</p><div id="userList"><span class="subtle">Đang tải tài khoản…</span></div><button class="btn primary" onclick="userModal()" style="margin-top:12px">＋ Thêm tài khoản nhân viên</button></section><section class="card setting"><h3>Phiên bản</h3><p>Hoàng Nhật SCM<br>Bản hệ thống nội bộ v1.4<br>© 2026</p></section></div>`;
}
async function exportReportXlsx() {
  try {
    const response = await fetch("/api/report.xlsx", { cache: "no-store" });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return toast(error.error || "Không xuất được file Excel");
    }
    const blob = await response.blob(),
      url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = "hoang-nhat-scm-report.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast("Đã tải báo cáo Excel");
  } catch (e) {
    toast("Không kết nối được máy chủ");
  }
}
function downloadImportTemplate() {
  const csv =
    "\ufeffMã NVL,Tên nguyên vật liệu,Nhóm,ĐVT,Tồn thực tế,Tồn tối thiểu,Giá gần nhất\r\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  a.download = "mau-danh-muc-kho.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}
function parseCSV(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
async function importMaterialsCSV(input) {
  if (currentRole !== "admin") {
    toast("Chỉ quản trị viên mới được nhập dữ liệu");
    input.value = "";
    return;
  }
  const file = input.files?.[0];
  if (!file) return;
  const original = structuredClone(data.materials);
  try {
    const rows = parseCSV((await file.text()).replace(/^\uFEFF/, ""));
    if (rows.length < 2) throw Error("File CSV chưa có dòng dữ liệu");
    const headers = rows[0].map((x) => x.trim().toLowerCase());
    const cols = [
      "mã nvl",
      "tên nguyên vật liệu",
      "nhóm",
      "đvt",
      "tồn thực tế",
      "tồn tối thiểu",
      "giá gần nhất",
    ];
    const idx = cols.map((x) => headers.indexOf(x));
    if (idx.some((i) => i < 0))
      throw Error("Cột CSV chưa đúng. Tải mẫu CSV để xem tên cột bắt buộc.");
    const imported = rows
      .slice(1)
      .map((r) => idx.map((i) => r[i] || ""))
      .filter((r) => r[0].trim() && r[1].trim());
    if (!imported.length) throw Error("Không tìm thấy dòng NVL hợp lệ");
    const parseNumber = (v) => {
      const x = String(v).trim();
      if (!x) return 0;
      const normalized =
        x.includes(",") && x.includes(".")
          ? x.replaceAll(".", "").replace(",", ".")
          : x.includes(",")
            ? x.replace(",", ".")
            : x;
      return Number(normalized);
    };
    const map = new Map(data.materials.map((m) => [m[0], m]));
    let added = 0,
      updated = 0;
    for (const r of imported) {
      const numbers = r.slice(4).map(parseNumber);
      if (numbers.some((n) => !Number.isFinite(n) || n < 0))
        throw Error(`Số liệu tồn/giá không hợp lệ ở mã ${r[0]}`);
      const old = map.get(r[0].trim());
      const next = [
        r[0].trim(),
        r[1].trim(),
        r[2].trim() || "Khác",
        r[3].trim() || "Cái",
        numbers[0],
        numbers[1],
        numbers[2],
      ];
      if (old) {
        old[1] = next[1];
        old[2] = next[2];
        old[3] = next[3];
        old[4] = next[4];
        old[5] = next[5];
        old[6] = next[6];
        updated++;
      } else {
        data.materials.push(next);
        map.set(next[0], next);
        added++;
      }
    }
    if (
      !confirm(
        `Nhập ${imported.length} mã NVL (${added} mã mới, ${updated} cập nhật). Tồn hiện tại của mã trùng sẽ được thay bằng số trong file. Tiếp tục?`,
      )
    ) {
      data.materials = original;
      return;
    }
    if (await persist()) {
      toast(`Đã nhập ${added} mã mới, cập nhật ${updated} mã`);
      render();
    }
  } catch (e) {
    data.materials = original;
    toast(e.message);
  } finally {
    input.value = "";
  }
}
function exportCSV() {
  const lines = [
    [
      "Mã NVL",
      "Tên nguyên vật liệu",
      "Nhóm",
      "ĐVT",
      "Tồn thực tế",
      "Tồn tối thiểu",
      "Giá trị tồn",
    ],
    ...data.materials.map((m) => [
      m[0],
      m[1],
      m[2],
      m[3],
      m[4],
      m[5],
      m[4] * m[6],
    ]),
  ];
  const csv =
      "\ufeff" +
      lines
        .map((row) =>
          row.map((x) => '"' + String(x).replaceAll('"', '""') + '"').join(","),
        )
        .join("\n"),
    a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  a.download = "hoang-nhat-scm-ton-kho.csv";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Đã xuất báo cáo CSV");
}
