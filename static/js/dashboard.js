function viewLedger() {
  return `${head("Sổ kho", "Lịch sử nhập, xuất và điều chỉnh tồn được ghi nhận từ các thao tác đã lưu.", `<button class="btn" onclick="exportLedgerCSV()">Xuất sổ CSV</button>`)}<section class="card table-card"><div class="table-toolbar"><h2>Giao dịch (${data.ledger.length})</h2><input class="field" id="ledgerSearch" placeholder="Tìm mã NVL hoặc mã tham chiếu" oninput="filterLedger()"><select class="select" id="ledgerKind" onchange="filterLedger()"><option value="">Tất cả giao dịch</option><option>Nhập</option><option>Xuất</option><option>Kiểm kê</option></select></div><div class="table-wrap"><table><thead><tr><th>NGÀY</th><th>MÃ NVL</th><th>TÊN NVL</th><th>LOẠI</th><th>SỐ LƯỢNG</th><th>THAM CHIẾU</th></tr></thead><tbody id="ledgerRows">${
    data.ledger
      .map((r) => {
        const m = data.materials.find((x) => x[0] === r[1]);
        return `<tr data-kind="${esc(r[2])}"><td>${esc(r[0])}</td><td class="code">${esc(r[1])}</td><td>${esc(m?.[1] || "NVL đã xóa")}</td><td>${esc(r[2])}</td><td>${Number(r[3]).toLocaleString("vi-VN")} ${esc(m?.[3] || "")}</td><td>${esc(r[4])}</td></tr>`;
      })
      .join("") ||
    '<tr><td colspan="6" class="empty-state">Chưa có giao dịch nào.</td></tr>'
  }</tbody></table></div></section>`;
}
function filterLedger() {
  const q = document.getElementById("ledgerSearch").value.toLowerCase(),
    k = document.getElementById("ledgerKind").value;
  document
    .querySelectorAll("#ledgerRows tr[data-kind]")
    .forEach(
      (r) =>
        (r.hidden = !(
          r.textContent.toLowerCase().includes(q) &&
          (!k || r.dataset.kind === k)
        )),
    );
}
function exportLedgerCSV() {
  const lines = [
    ["Ngày", "Mã NVL", "Tên NVL", "Loại", "Số lượng", "ĐVT", "Tham chiếu"],
    ...data.ledger.map((r) => {
      const m = data.materials.find((x) => x[0] === r[1]);
      return [r[0], r[1], m?.[1] || "", r[2], r[3], m?.[3] || "", r[4]];
    }),
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
  a.download = "hoang-nhat-so-kho.csv";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Đã xuất sổ kho CSV");
}
function parseLocalDate(value) {
  const text = String(value || "");
  let m;
  if ((m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)))
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if ((m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)))
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(NaN);
}
function viewDashboard() {
  const ready = data.materials.filter((m) => status(m) === "Đủ hàng").length,
    urgent = data.materials.filter((m) => status(m) === "Cần mua gấp").length,
    now = new Date(),
    thisMonth = data.ledger.filter((r) => {
      const d = parseLocalDate(r[0]);
      return (
        !Number.isNaN(d.valueOf()) &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
      );
    }),
    incoming = thisMonth
      .filter((r) => r[2] === "Nhập")
      .reduce((s, r) => s + Number(r[3]), 0),
    outgoing = thisMonth
      .filter((r) => r[2] === "Xuất")
      .reduce((s, r) => s + Math.abs(Number(r[3])), 0),
    groups = new Map();
  data.materials.forEach((m) =>
    groups.set(m[2], (groups.get(m[2]) || 0) + qty(m) * Number(m[6] || 0)),
  );
  const groupRows = [...groups].sort((a, b) => b[1] - a[1]),
    maxGroup = Math.max(1, ...groupRows.map((x) => x[1]));
  return `${head("Bảng điều khiển", "Tổng quan tồn kho và giao dịch đã ghi sổ trong tháng hiện tại.")}<div class="grid stats">${stat("Giá trị tồn kho", money(totalStock()), `${data.materials.length} mã nguyên vật liệu`, "◈")}${stat(
    "Dòng nhập kho",
    thisMonth.filter((r) => r[2] === "Nhập").length + " dòng",
    `${
      data.receipts.filter((r) => {
        const d = parseLocalDate(r[1]);
        return (
          !Number.isNaN(d.valueOf()) &&
          d.getMonth() === now.getMonth() &&
          d.getFullYear() === now.getFullYear()
        );
      }).length
    } phiếu trong tháng`,
    "↙",
    "green",
  )}${stat(
    "Dòng xuất kho",
    thisMonth.filter((r) => r[2] === "Xuất").length + " dòng",
    `${
      data.issues.filter((r) => {
        const d = parseLocalDate(r[1]);
        return (
          !Number.isNaN(d.valueOf()) &&
          d.getMonth() === now.getMonth() &&
          d.getFullYear() === now.getFullYear()
        );
      }).length
    } phiếu trong tháng`,
    "↗",
    "amber",
  )}${stat("Cần mua gấp", urgent + " mã", "Dưới mức tồn tối thiểu", "!", "red")}</div><div class="grid dashboard-grid"><section class="card panel"><div class="panel-head"><div><h2>Giao dịch kho gần đây</h2><p>Đọc từ sổ giao dịch, mới nhất trước</p></div><button class="link-button" onclick="go('ledger')">Mở sổ kho →</button></div>${
    data.ledger.length
      ? `<div class="table-wrap"><table><thead><tr><th>NGÀY</th><th>MÃ NVL</th><th>GIAO DỊCH</th><th>SỐ LƯỢNG</th><th>MÃ THAM CHIẾU</th></tr></thead><tbody>${data.ledger
          .slice(0, 7)
          .map(
            (r) =>
              `<tr><td>${esc(r[0])}</td><td class="code">${esc(r[1])}</td><td>${esc(r[2])}</td><td>${Number(r[3]).toLocaleString("vi-VN")}</td><td>${esc(r[4])}</td></tr>`,
          )
          .join("")}</tbody></table></div>`
      : '<div class="empty-state">Chưa có giao dịch. Lập phiếu nhập hoặc kiểm kê để bắt đầu ghi sổ.</div>'
  }</section><section class="card panel"><div class="panel-head"><div><h2>Giá trị tồn theo nhóm</h2><p>Tồn hiện tại × giá nhập gần nhất</p></div></div>${groupRows.length ? `<div class="legend-list">${groupRows.map(([name, value]) => `<div class="group-value"><div><span>${esc(name)}</span><b>${money(value)}</b></div><div class="group-bar"><i style="width:${Math.max(2, (value / maxGroup) * 100)}%"></i></div></div>`).join("")}</div>` : '<div class="empty-state">Thêm danh mục NVL để xem giá trị tồn theo nhóm.</div>'}</section></div><div class="stock-alerts"><div class="card alert-card"><span class="alert-icon">✓</span><div><b>${ready} mã</b><small>NVL đủ hàng trên ngưỡng an toàn</small></div><div class="top-spacer"></div><div class="mini-bar"><i style="--h:${Math.max(0, (ready / Math.max(1, data.materials.length)) * 100)}%"></i></div></div><div class="card alert-card"><span class="alert-icon" style="background:#fff6e9;color:#c18119">!</span><div><b>${data.materials.filter((m) => status(m) === "Sắp hết").length} mã</b><small>NVL sắp hết · cần theo dõi</small></div><div class="top-spacer"></div></div><div class="card alert-card"><span class="alert-icon red">↓</span><div><b>${urgent} mã</b><small>Đã chạm hoặc dưới tồn tối thiểu</small></div><div class="top-spacer"></div><button class="link-button" onclick="go('materials')">Xem danh sách →</button></div></div>${materialTable(true)}`;
}
