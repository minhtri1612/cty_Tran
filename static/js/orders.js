function viewOrders() {
  return `${head("Đơn hàng may", "Quản lý hợp đồng khách hàng và theo dõi nguyên vật liệu đã cấp phát.", `<button class="btn primary" onclick="orderModal()">＋ Tạo đơn hàng may</button>`)}<section class="card table-card"><div class="table-toolbar"><h2>Danh sách đơn hàng may</h2><input class="field" id="orderSearch" placeholder="⌕ Tìm khách hàng, mã đơn..." oninput="filterSimple('orderSearch','orderRows')"><select class="select" id="orderStatus" onchange="filterOrders()"><option value="">Tất cả trạng thái</option><option>Đang thực hiện</option><option>Hoàn thành</option></select><select class="select" id="orderCustomer" onchange="filterOrders()"><option value="">Tất cả khách hàng</option>${data.customers.map((x) => `<option>${esc(x)}</option>`).join("")}</select></div><div class="table-wrap"><table><thead><tr><th>MÃ ĐƠN</th><th>KHÁCH HÀNG</th><th>NGÀY KÝ</th><th>SẢN PHẨM</th><th>SỐ LƯỢNG ĐẶT</th><th>SỐ PHIẾU XUẤT</th><th>TRẠNG THÁI</th><th></th></tr></thead><tbody id="orderRows">${data.orders.map((o) => `<tr data-customer="${esc(o[1])}" data-status="${esc(o[6])}"><td class="code">${esc(o[0])}</td><td class="primary-text">${esc(o[1])}</td><td>${esc(o[2])}</td><td>${esc(o[3])}</td><td>${esc(o[4])} ${esc(data.order_details?.[o[0]]?.unit || "")}</td><td>${data.issues.filter((x) => x[3] === o[0]).length}</td><td>${badge(o[6])}</td><td><button class="link-button" ${act("showOrderDetails", o[0])}>Chi tiết</button></td></tr>`).join("")}</tbody></table></div></section>`;
}
function showOrderDetails(id) {
  const order = data.orders.find((o) => o[0] === id);
  if (!order) return toast("Không tìm thấy đơn hàng");
  const docs = data.issues.filter((x) => x[3] === id),
    detail = data.order_details?.[id] || {},
    planned = detail.materials || [];
  document.getElementById("modalRoot").innerHTML =
    `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><section class="modal" role="dialog"><div class="modal-head"><h2>Đơn hàng · ${esc(id)}</h2><button onclick="closeModal()">×</button></div><div class="modal-body"><p><b>Khách hàng:</b> ${esc(order[1])}</p><p><b>Ngày ký:</b> ${esc(order[2])} &nbsp; <b>Sản phẩm:</b> ${esc(order[3])}</p><p><b>Số lượng đặt:</b> ${esc(order[4])} ${esc(detail.unit || "")} &nbsp; <b>Trạng thái:</b> ${esc(order[6])}</p>${detail.photo ? `<img class="order-product-photo" src="${esc(detail.photo)}" alt="${esc(order[3])}">` : ""}<p><b>Cho phép xuất dư:</b> ${Number(detail.extra_pct || 0).toLocaleString("vi-VN")}%</p>${detail.note ? `<p><b>Ghi chú:</b> ${esc(detail.note)}</p>` : ""}<h3>Nguyên vật liệu cần cho đơn này</h3>${
      planned.length
        ? `<div class="table-wrap"><table><thead><tr><th>MÃ NVL</th><th>TÊN</th><th>ĐVT</th><th>ĐỊNH MỨC</th><th>ĐƯỢC XUẤT TỐI ĐA</th></tr></thead><tbody>${planned
            .map((line) => {
              const m = data.materials.find((x) => x[0] === line.code);
              return `<tr><td class="code">${esc(line.code)}</td><td>${esc(m?.[1] || "NVL đã xóa")}</td><td>${esc(m?.[3] || "")}</td><td>${Number(line.qty).toLocaleString("vi-VN")}</td><td>${(Number(line.qty) * (1 + Number(detail.extra_pct || 0) / 100)).toLocaleString("vi-VN")}</td></tr>`;
            })
            .join("")}</tbody></table></div>`
        : '<p class="subtle">Đơn hàng chưa khai báo định mức nguyên vật liệu.</p>'
    }<button class="btn small" ${act("toggleOrderStatus", order[0])}>${order[6] === "Hoàn thành" ? "Mở lại đơn" : "Đánh dấu hoàn thành"}</button><h3>Phiếu xuất liên quan (${docs.length})</h3>${docs.length ? `<div class="table-wrap"><table><thead><tr><th>MÃ PHIẾU</th><th>NGÀY</th><th>KHÁCH HÀNG</th><th></th></tr></thead><tbody>${docs.map((x) => `<tr><td>${esc(x[0])}</td><td>${esc(x[1])}</td><td>${esc(x[2])}</td><td><button class="link-button" ${actClose("showDocDetails", x[0], "issues")}>Chi tiết</button></td></tr>`).join("")}</tbody></table></div>` : '<p class="subtle">Chưa có phiếu xuất gắn với đơn hàng này.</p>'}</div><div class="modal-foot"><button class="btn primary" onclick="closeModal()">Đóng</button></div></section></div>`;
}
async function toggleOrderStatus(id) {
  const order = data.orders.find((o) => o[0] === id);
  if (!order) return toast("Không tìm thấy đơn hàng");
  order[6] = order[6] === "Hoàn thành" ? "Đang thực hiện" : "Hoàn thành";
  if (await persist()) {
    render();
    showOrderDetails(id);
    toast("Đã cập nhật trạng thái đơn hàng");
  }
}
function filterSimple(a, b) {
  const q = document.getElementById(a).value.toLowerCase();
  document
    .querySelectorAll(`#${b} tr`)
    .forEach((r) => (r.hidden = !r.textContent.toLowerCase().includes(q)));
}
function filterOrders() {
  const q = document.getElementById("orderSearch").value.toLowerCase(),
    s = document.getElementById("orderStatus").value,
    c = document.getElementById("orderCustomer").value;
  document
    .querySelectorAll("#orderRows tr")
    .forEach(
      (r) =>
        (r.hidden = !(
          r.textContent.toLowerCase().includes(q) &&
          (!s || r.dataset.status === s) &&
          (!c || r.dataset.customer === c)
        )),
    );
}
function addOrderMaterialLine(line = {}) {
  const row = document.createElement("div");
  row.className = "order-material-line";
  row.innerHTML = `<select class="order-mat-code"><option value="">Chọn nguyên vật liệu</option>${data.materials.map((m) => `<option value="${esc(m[0])}" ${m[0] === line.code ? "selected" : ""}>${esc(m[0])} — ${esc(m[1])} (${esc(m[3])})</option>`).join("")}</select><input class="order-mat-qty" type="number" min="0.000001" step="any" value="${line.qty ?? ""}" placeholder="Tổng định mức NVL"><button class="btn small" type="button" onclick="this.parentElement.remove()">Xóa</button>`;
  document.getElementById("orderMaterials").appendChild(row);
}
async function orderPhotoRead(file) {
  if (!file) return;
  try {
    const value = await resizeImageData(file);
    document.getElementById("orderPhotoData").value = value;
    document.getElementById("orderPhotoPreview").innerHTML = value
      ? `<img src="${esc(value)}" alt="Ảnh sản phẩm">`
      : "▧";
  } catch (e) {
    toast(e.message || "Không đọc được ảnh này");
  }
}
function issueExceedsOrderAllowance(orderId, lines, excludeDocId = null) {
  const detail = data.order_details?.[orderId],
    planned = detail?.materials || [];
  if (!planned.length) return "";
  const issues = data.issues.filter(
      (r) => r[3] === orderId && r[0] !== excludeDocId,
    ),
    used = new Map();
  for (const issue of issues)
    for (const event of data.ledger.filter(
      (x) => x[4] === issue[0] && x[2] === "Xuất",
    ))
      used.set(
        event[1],
        (used.get(event[1]) || 0) + Math.abs(Number(event[3])),
      );
  const added = new Map();
  for (const line of lines)
    added.set(line.code, (added.get(line.code) || 0) + line.qty);
  for (const plan of planned) {
    const maximum =
        Number(plan.qty) * (1 + Number(detail.extra_pct || 0) / 100),
      actual = (used.get(plan.code) || 0) + (added.get(plan.code) || 0);
    if (actual > maximum + 1e-8) {
      const m = data.materials.find((x) => x[0] === plan.code);
      return `Vượt định mức cho ${plan.code} (${m?.[1] || "NVL"}): tối đa ${maximum.toLocaleString("vi-VN")} ${m?.[3] || ""}`;
    }
  }
  for (const code of added.keys())
    if (!planned.some((x) => x.code === code))
      return `Đơn hàng chưa khai báo định mức cho mã ${code}`;
  return "";
}
function orderModal() {
  openModal(
    "Tạo đơn hàng may",
    `<p class="subtle">Một đơn là một hợp đồng với khách hàng và ngày ký. Phiếu xuất được gắn vào đơn khi lập phiếu.</p><div class="form-grid"><div class="form-field"><label>Khách hàng *</label><select id="orderClient"><option value="">— Chọn khách hàng —</option>${data.customers.map((x) => `<option>${esc(x)}</option>`).join("")}</select></div><div class="form-field"><label>Ngày ký hợp đồng *</label><input id="orderDate" type="date" value="${todayValue()}"></div><div class="form-field full"><label>Sản phẩm *</label><input id="orderProduct" maxlength="200" placeholder="Tên sản phẩm"></div><div class="form-field"><label>Số lượng đơn *</label><input id="orderQty" type="number" min="0.000001" step="any" placeholder="Số lượng"></div><div class="form-field"><label>ĐVT đơn</label><input id="orderUnit" maxlength="40" value="túi"></div><div class="form-field full"><label>Cho phép xuất dư cho cả đơn (%)</label><input id="orderExtraPct" type="number" min="0" max="1000" step="any" value="0"><span class="hint">Tính trên tổng nguyên vật liệu xuất cho đơn này. Để 0 nếu không cho xuất dư.</span></div><div class="form-field full"><div class="order-material-panel"><b>Nguyên vật liệu cần cho đơn này</b><p>Khai trước định mức tổng cho đơn. Phiếu xuất gắn với đơn sẽ được kiểm tra theo định mức này.</p><div id="orderMaterials"></div><button class="btn small" type="button" onclick="addOrderMaterialLine()">＋ Thêm nguyên vật liệu</button></div></div><div class="form-field full"><label>Ảnh sản phẩm</label><div class="order-photo-upload"><div id="orderPhotoPreview" class="supplier-product-thumb large">▧</div><input id="orderPhotoData" type="hidden"><input id="orderPhotoFile" type="file" accept="image/jpeg,image/png,image/webp" hidden onchange="orderPhotoRead(this.files[0]);this.value=''"><button class="btn" type="button" onclick="document.getElementById('orderPhotoFile').click()">⇧ Tải ảnh từ máy</button></div></div><div class="form-field full"><label>Ghi chú</label><textarea id="orderNote" maxlength="2000" placeholder="Thông tin bổ sung"></textarea></div></div>`,
    async () => {
      const client = document.getElementById("orderClient").value,
        rawDate = document.getElementById("orderDate").value,
        product = document.getElementById("orderProduct").value.trim(),
        rawQty = document.getElementById("orderQty").value,
        quantity = Number(rawQty),
        extra = Number(document.getElementById("orderExtraPct").value || 0);
      if (!client) return toast("Vui lòng chọn khách hàng");
      if (!rawDate) return toast("Vui lòng chọn ngày ký");
      if (!product) return toast("Vui lòng nhập sản phẩm");
      if (!rawQty || !Number.isFinite(quantity) || quantity <= 0)
        return toast("Số lượng đơn phải lớn hơn 0");
      if (!Number.isFinite(extra) || extra < 0 || extra > 1000)
        return toast("Tỷ lệ xuất dư phải từ 0 đến 1000%");
      const planned = [],
        seen = new Set();
      for (const row of document.querySelectorAll(".order-material-line")) {
        const code = row.querySelector(".order-mat-code").value,
          raw = row.querySelector(".order-mat-qty").value;
        if (!code || !raw)
          return toast("Chọn nguyên vật liệu và nhập định mức cho từng dòng");
        const qty = Number(raw);
        if (!Number.isFinite(qty) || qty <= 0)
          return toast("Định mức nguyên vật liệu phải lớn hơn 0");
        if (seen.has(code))
          return toast("Mỗi mã nguyên vật liệu chỉ được khai báo một lần");
        seen.add(code);
        planned.push({ code, qty });
      }
      const date = rawDate.split("-").reverse().join("/"),
        id = makeId("DH-"),
        details = {
          unit: document.getElementById("orderUnit").value.trim(),
          extra_pct: extra,
          materials: planned,
          note: document.getElementById("orderNote").value.trim(),
          photo: document.getElementById("orderPhotoData").value,
        };
      data.orders.unshift([
        id,
        client,
        date,
        product,
        String(quantity),
        "0",
        "Đang thực hiện",
      ]);
      data.order_details = data.order_details || {};
      data.order_details[id] = details;
      if (await persist()) {
        closeModal();
        go("orders");
        toast("Đã tạo đơn hàng");
      }
    },
  );
}
