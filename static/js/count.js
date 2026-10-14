function viewCount() {
  const groups = [
    ...new Set(data.materials.map((m) => m[2]).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "vi"));
  const recent = (data.counts || []).slice(0, 8);
  return `${head("Kiểm kê kho", "Nhập số đếm thực tế cho từng mã. Ô để trống là không kiểm mã đó. Lưu một lần thành một phiếu tồn kho gồm các mã có chênh lệch, ghi ngày hôm nay.", `<button class="btn" onclick="go('materials')">← Danh mục NVL</button><button class="btn primary" onclick="saveCount()">✓ Lưu kiểm kê</button>`)}<details class="card count-guide" open><summary>Cách kiểm kê</summary><ol><li>Ra kho đếm hoặc đo từng loại hàng.</li><li>Gõ số đếm được vào cột "Số đếm thực tế". Mã nào khớp với số trên máy thì bỏ trống. Nếu phần lớn khớp, bấm "Điền bằng tồn hệ thống" rồi chỉ sửa mã bị lệch.</li><li>Xem cột "Chênh": số xanh (+) là kho thật nhiều hơn trên máy, số đỏ (−) là kho thật ít hơn.</li><li>Bấm "Lưu kiểm kê": máy sửa tồn cho khớp số thật và lưu một phiếu kiểm kê để tra lại sau.</li></ol><p><b>Lưu ý:</b> nên đếm lúc không có ai nhập/xuất hàng. Kiểm kê xong coi như chốt sổ — không ghi lùi phiếu về trước ngày kiểm kê.</p></details><section class="card table-card"><div class="table-toolbar"><h2>Bảng kiểm kê nguyên vật liệu</h2><input class="field" id="countSearch" placeholder="Tìm mã hoặc tên NVL" oninput="filterCount()"><label class="subtle" for="countGroup">Nhóm</label><select class="select" id="countGroup" onchange="filterCount()"><option value="">Tất cả (${data.materials.length})</option>${groups.map((g) => `<option value="${esc(g)}">${esc(g)} (${data.materials.filter((m) => m[2] === g).length})</option>`).join("")}</select><button class="btn soft" onclick="fillCount()">Điền bằng tồn hệ thống</button></div><div class="table-wrap"><table id="countTable"><thead><tr><th>MÃ</th><th>TÊN</th><th>ĐVT</th><th>TỒN HỆ THỐNG</th><th>SỐ ĐẾM THỰC TẾ</th><th>CHÊNH</th></tr></thead><tbody>${data.materials
    .slice()
    .sort((a, b) => a[0].localeCompare(b[0], "vi"))
    .map(
      (m) =>
        `<tr data-code="${esc(m[0])}" data-group="${esc(m[2])}"><td class="code">${esc(m[0])}</td><td>${esc(m[1])}</td><td>${esc(m[3])}</td><td>${qty(m).toLocaleString("vi-VN")}</td><td><input type="number" min="0" step="any" class="field count-input" data-code="${esc(m[0])}" placeholder="—" oninput="countDiff(this)" style="min-width:110px"></td><td class="diff subtle">—</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></div><div class="table-toolbar count-summary"><span class="subtle" id="countSummary">0 mã có chênh lệch (0 mã đã đếm)</span><input class="field" id="countNote" maxlength="1000" placeholder="Ghi chú kiểm kê (không bắt buộc)"></div></section><section class="card table-card"><div class="table-toolbar"><h2>Các lần kiểm kê gần đây</h2></div><div class="table-wrap"><table><thead><tr><th>MÃ PHIẾU</th><th>NGÀY</th><th>SỐ MÃ CHÊNH</th><th>NGƯỜI LẬP</th><th>GHI CHÚ</th><th></th></tr></thead><tbody>${recent.map((c) => `<tr><td class="code">${esc(c.id)}</td><td>${esc(c.date)}</td><td>${c.lines.length}</td><td>${esc(c.created_by || "—")}</td><td>${esc(c.note || "—")}</td><td><button class="link-button" ${act("showCountDetails", c.id)}>Chi tiết</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty-state">Chưa có lần kiểm kê nào.</td></tr>'}</tbody></table></div></section>`;
}
function fillCount() {
  document.querySelectorAll(".count-input").forEach((i) => {
    const m = data.materials.find((x) => x[0] === i.dataset.code);
    i.value = qty(m);
    countDiff(i);
  });
}
function countDiff(i) {
  const tr = i.closest("tr"),
    d = tr.querySelector(".diff"),
    before = Number(
      tr.children[3].textContent.replaceAll(".", "").replace(",", "."),
    ),
    n = i.value === "" ? null : Number(i.value) - before;
  d.innerHTML =
    n === null
      ? "—"
      : `<b style="color:${n > 0 ? "#188457" : n < 0 ? "#c94b52" : "#65758b"}">${n > 0 ? "+" : ""}${n.toLocaleString("vi-VN")}</b>`;
  updateCountSummary();
}
function updateCountSummary() {
  const inputs = [...document.querySelectorAll(".count-input")],
    counted = inputs.filter((i) => i.value !== ""),
    changed = counted.filter(
      (i) =>
        Number(i.value) !==
        qty(data.materials.find((m) => m[0] === i.dataset.code)),
    );
  const box = document.getElementById("countSummary");
  if (box)
    box.textContent = `${changed.length} mã có chênh lệch (${counted.length} mã đã đếm)`;
}
function filterCount() {
  const q = (document.getElementById("countSearch")?.value || "").toLowerCase(),
    g = document.getElementById("countGroup")?.value || "";
  document
    .querySelectorAll("#countTable tbody tr")
    .forEach(
      (r) =>
        (r.hidden = !(
          r.textContent.toLowerCase().includes(q) &&
          (!g || r.dataset.group === g)
        )),
    );
}
async function saveCount() {
  const changes = [...document.querySelectorAll(".count-input")].filter(
    (i) =>
      i.value !== "" &&
      Number(i.value) !==
        qty(data.materials.find((m) => m[0] === i.dataset.code)),
  );
  if (!changes.length) return toast("Không có mã nào chênh lệch");
  if (
    changes.some(
      (i) => !Number.isFinite(Number(i.value)) || Number(i.value) < 0,
    )
  )
    return toast("Số đếm phải là số không âm");
  const date = todayValue().split("-").reverse().join("/"),
    id = makeId("KK-"),
    lines = changes.map((i) => {
      const m = data.materials.find((x) => x[0] === i.dataset.code),
        before = qty(m),
        counted = Number(i.value),
        delta = counted - before;
      m[4] = counted;
      data.ledger.unshift([date, i.dataset.code, "Kiểm kê", delta, id]);
      return { code: i.dataset.code, before, counted, delta };
    });
  data.counts = data.counts || [];
  data.counts.unshift({
    id,
    date,
    note: document.getElementById("countNote")?.value.trim() || "",
    created_by: currentUser,
    lines,
  });
  if (await persist()) {
    toast(`Đã lưu phiếu kiểm kê ${id} · ${changes.length} mã`);
    render();
  }
}
function showCountDetails(id) {
  const count = (data.counts || []).find((c) => c.id === id);
  if (!count) return toast("Không tìm thấy phiếu kiểm kê");
  openModal(
    `Phiếu kiểm kê ${count.id}`,
    `<p><b>Ngày:</b> ${esc(count.date)} &nbsp; <b>Người lập:</b> ${esc(count.created_by || "—")}</p><p><b>Ghi chú:</b> ${esc(count.note || "—")}</p><div class="table-wrap"><table><thead><tr><th>MÃ NVL</th><th>TÊN NVL</th><th>TỒN TRƯỚC</th><th>SỐ ĐẾM</th><th>CHÊNH</th></tr></thead><tbody>${count.lines
      .map((line) => {
        const m = data.materials.find((x) => x[0] === line.code);
        return `<tr><td class="code">${esc(line.code)}</td><td>${esc(m?.[1] || "NVL đã xóa")}</td><td>${Number(line.before).toLocaleString("vi-VN")}</td><td>${Number(line.counted).toLocaleString("vi-VN")}</td><td>${line.delta > 0 ? "+" : ""}${Number(line.delta).toLocaleString("vi-VN")}</td></tr>`;
      })
      .join("")}</tbody></table></div>`,
  );
}
