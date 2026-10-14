function matProfile(code) {
  return (data.material_profiles && data.material_profiles[code]) || {};
}
function materialTable(dashboard = false) {
  let rows = data.materials.slice(0, dashboard ? 7 : data.materials.length);
  if (dashboard) {
    return `<section class="card table-card"><div class="table-toolbar"><h2>Danh sách nguyên vật liệu <span class="subtle">(${data.materials.length})</span></h2><button class="link-button" onclick="go('materials')">Xem tất cả →</button></div><div class="table-wrap"><table id="materialTable"><thead><tr><th>Mã NVL</th><th>Tên nguyên vật liệu</th><th>Phân loại</th><th>ĐVT</th><th>Tồn thực tế</th><th>Tình trạng</th></tr></thead><tbody>${rows.map((m) => `<tr class="click-row" ${act("materialDetail", m[0])}><td class="code">${esc(m[0])}</td><td><div class="primary-text">${esc(m[1])}</div></td><td>${esc(m[2])}</td><td>${esc(m[3])}</td><td>${qty(m).toLocaleString("vi-VN")}</td><td>${badge(status(m))}</td></tr>`).join("")}</tbody></table></div></section>`;
  }
  return `<section class="card table-card"><div class="table-toolbar"><h2>Tất cả nguyên vật liệu <span class="subtle">(${data.materials.length})</span></h2><input class="field mat-search" id="matSearch" placeholder="Tìm mã hoặc tên nguyên vật liệu" oninput="filterMaterials()"><select class="select" id="groupFilter" onchange="filterMaterials()"><option value="">Tất cả phân loại</option>${[...new Set(data.materials.map((m) => m[2]))].map((x) => `<option>${esc(x)}</option>`).join("")}</select><select class="select" id="statusFilter" onchange="filterMaterials()"><option value="">Tất cả tình trạng</option><option>Đủ hàng</option><option>Sắp hết</option><option>Cần mua gấp</option></select></div><div class="table-wrap"><table id="materialTable"><thead><tr><th>Mã NVL</th><th>Tên nguyên vật liệu</th><th>Phân loại</th><th>ĐVT</th><th>Nhà cung cấp</th><th>Giá gần nhất</th><th>Tồn tối thiểu</th><th>Tồn thực tế</th><th>Tình trạng</th><th>Thao tác</th></tr></thead><tbody>${
    rows
      .map((m) => {
        const profile = matProfile(m[0]);
        return `<tr class="click-row" ${act("materialDetail", m[0])} data-key="${esc(m[0])}" data-group="${esc(m[2])}" data-status="${status(m)}"><td class="code">${esc(m[0])}</td><td><div class="mat-name">${profile.photo ? `<img class="mat-thumb" src="${esc(profile.photo)}" alt="">` : `<span class="mat-thumb">${esc((m[1] || "?").slice(0, 1))}</span>`}<div class="primary-text">${esc(m[1])}</div></div></td><td>${esc(m[2])}</td><td>${esc(m[3])}</td><td>${esc(profile.supplier || "—")}</td><td>${money(m[6])}</td><td>${Number(m[5]).toLocaleString("vi-VN")}</td><td>${qty(m).toLocaleString("vi-VN")}</td><td>${badge(status(m))}</td><td class="mat-actions"><button class="icon-button" title="Xem tóm tắt" ${act("materialDetail", m[0])}>👁</button><button class="link-button" ${act("materialDetail", m[0], "history")}>Lịch sử</button>${currentRole === "admin" ? `<button class="link-button" ${act("editMaterial", m[0])}>Sửa</button>` : ""}</td></tr>`;
      })
      .join("") ||
    '<tr><td colspan="10" class="empty-state">Chưa có nguyên vật liệu.</td></tr>'
  }</tbody></table></div><div class="table-toolbar"><span class="subtle" id="matCount">Đang hiển thị ${rows.length} mã</span><div class="top-spacer"></div><button class="btn small" onclick="exportCSV()">Xuất danh sách</button></div></section>`;
}
function materialDetail(code, tab = "info") {
  const m = data.materials.find((x) => x[0] === code);
  if (!m) return toast("Không tìm thấy nguyên vật liệu");
  const profile = matProfile(code),
    supplier = data.supplier_profiles?.[profile.supplier] || {},
    stock = qty(m),
    rows = data.ledger.filter((r) => r[1] === code);
  const line = (k, v) =>
    `<div class="kv"><span>${k}</span><b>${v || "—"}</b></div>`;
  const info = `<div class="mat-detail-photo">${profile.photo ? `<img src="${esc(profile.photo)}" alt="">` : "<span>Chưa có ảnh</span>"}</div><h3>Thông tin chung</h3><div class="kv-list">${line("Mã NVL", esc(m[0]))}${line("Tên", esc(m[1]))}${line("Phân loại", esc(m[2]))}${line("Đơn vị tính", esc(m[3]))}${line("Màu sắc", esc(profile.color))}${line("Quy cách / Khổ", esc(profile.size_spec))}</div><h3>Tồn kho</h3><div class="kv-list">${line("Tồn thực tế", stock.toLocaleString("vi-VN"))}${line("Tồn tối thiểu", Number(m[5] || 0).toLocaleString("vi-VN"))}${line("Tình trạng", badge(status(m)))}${line("Giá gần nhất", money(m[6]))}${line("Giá trị tồn", money(stock * Number(m[6] || 0)))}</div><h3>Nhà cung cấp</h3><div class="kv-list">${line("Nhà cung cấp", esc(profile.supplier))}${line("Người liên hệ", "—")}${line("Số điện thoại", esc(supplier.phone))}${line("Loại NCC", esc(supplier.categories))}${line("Thời gian giao", esc(profile.lead_time))}${line("Đặt tối thiểu (MOQ)", esc(profile.moq))}</div><h3>Ghi chú</h3><div class="kv-list">${line("Ghi chú", esc(profile.note))}</div>`;
  let after = stock;
  const history = rows.length
    ? `<div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Phiếu</th><th>Loại</th><th>Số lượng</th><th>Tồn sau</th><th>Ghi chú</th></tr></thead><tbody>${rows
        .map((r) => {
          const amount = Number(r[3]);
          const balance = after;
          after -= amount;
          const note =
            r[4] === "Sửa hồ sơ" || r[4] === "Tồn ban đầu" ? r[4] : "";
          const doc = note ? "—" : r[4];
          return `<tr><td>${esc(r[0])}</td><td>${esc(doc)}</td><td>${esc(r[2])}</td><td>${amount > 0 ? "+" : ""}${amount.toLocaleString("vi-VN")}</td><td>${balance.toLocaleString("vi-VN")}</td><td>${esc(note || "—")}</td></tr>`;
        })
        .join("")}</tbody></table></div>`
    : '<div class="empty-state">Chưa có giao dịch nào cho mã này.</div>';
  openModal(
    esc(m[1]),
    `<p class="hint">Mã ${esc(m[0])}</p><div class="mat-tabs"><button type="button" class="${tab === "info" ? "on" : ""}" ${act("materialDetail", code, "info")}>Thông tin</button><button type="button" class="${tab === "history" ? "on" : ""}" ${act("materialDetail", code, "history")}>Lịch sử nhập xuất</button></div>${tab === "history" ? history : info}`,
  );
  document.querySelector("#modalRoot .modal")?.classList.add("wide");
  const foot = document.querySelector("#modalRoot .modal-foot");
  if (foot)
    foot.innerHTML = `<span class="grow"></span><button class="btn" onclick="closeModal()">Đóng</button>${currentRole === "admin" ? `<button class="btn primary" ${act("editMaterial", code)}>Sửa</button>` : ""}`;
}
function showMaterialHistory(code) {
  materialDetail(code, "history");
}
function viewMaterials() {
  return `${head("Danh mục nguyên vật liệu", "Theo dõi tồn kho thực tế, giá nhập gần nhất và ngưỡng tồn an toàn.", `<button class="btn" onclick="go('count')">☷ &nbsp;Kiểm kê kho</button>${currentRole === "admin" ? '<button class="btn primary" onclick="materialModal()">＋ Thêm nguyên vật liệu</button>' : ""}`)}<div class="grid stats">${stat("Tổng giá trị tồn kho", money(totalStock()), `${data.materials.length} mã nguyên vật liệu`, "◈")}${stat("Đủ hàng", data.materials.filter((m) => status(m) === "Đủ hàng").length + " mã", "Trên ngưỡng tồn an toàn", "✓", "green")}${stat("Sắp hết", data.materials.filter((m) => status(m) === "Sắp hết").length + " mã", "Cần theo dõi", "◷", "amber")}${stat("Cần mua gấp", data.materials.filter((m) => status(m) === "Cần mua gấp").length + " mã", "Dưới mức an toàn", "↓", "red")}</div>${materialTable(false)}`;
}
function filterMaterials() {
  const q = (document.getElementById("matSearch")?.value || "").toLowerCase(),
    g = document.getElementById("groupFilter")?.value || "",
    s = document.getElementById("statusFilter")?.value || "";
  let n = 0;
  document.querySelectorAll("#materialTable tbody tr").forEach((r) => {
    const show =
      (!q || r.textContent.toLowerCase().includes(q)) &&
      (!g || r.dataset.group === g) &&
      (!s || r.dataset.status === s);
    r.hidden = !show;
    if (show) n++;
  });
  document.getElementById("matCount").textContent = `Đang hiển thị ${n} mã`;
}

const MAT_GROUPS = [
  "Bao bì",
  "Chỉ may",
  "Dây kéo",
  "Keo",
  "Khác",
  "Mút EVA",
  "Phụ kiện kim loại",
  "Simili",
  "Thùng",
  "Vải",
  "Vải không dệt",
  "Văn Phòng Phẩm",
];
const MAT_UNITS = [
  "Mét",
  "Cái",
  "Cuộn",
  "Kg",
  "Bộ",
  "Tấm",
  "Cây",
  "Chai",
  "Hộp",
];
let matBatch = null;

function blankMatDraft() {
  return {
    code: "",
    name: "",
    group: "Bao bì",
    groupCustom: "",
    groupMode: "list",
    unit: "Mét",
    unitCustom: "",
    unitMode: "list",
    supplier: "",
    supplierCustom: "",
    supplierMode: "list",
    customer: "",
    customerCustom: "",
    customerMode: "list",
    spec: "",
    pack: "",
    color: "",
    size_spec: "",
    lead_time: "",
    moq: "",
    price: "",
    minimum: "",
    stock: "0",
    note: "",
    photo: "",
    open: true,
  };
}

function materialDraftFrom(code) {
  const m = code ? data.materials.find((x) => x[0] === code) : null;
  const profile = m ? matProfile(m[0]) : {};
  const draft = blankMatDraft();
  if (!m) return draft;
  draft.code = m[0];
  draft.name = m[1];
  draft.minimum = String(m[5] ?? 0);
  draft.price = String(m[6] ?? 0);
  draft.stock = String(m[4] ?? 0);
  draft.spec = profile.spec || "";
  draft.pack = profile.pack || "";
  draft.color = profile.color || "";
  draft.size_spec = profile.size_spec || "";
  draft.lead_time = profile.lead_time || "";
  draft.moq = profile.moq || "";
  draft.note = profile.note || "";
  draft.photo = profile.photo || "";
  if (m[2] && MAT_GROUPS.includes(m[2])) draft.group = m[2];
  else {
    draft.groupMode = "custom";
    draft.groupCustom = m[2] || "";
  }
  if (m[3] && MAT_UNITS.includes(m[3])) draft.unit = m[3];
  else {
    draft.unitMode = "custom";
    draft.unitCustom = m[3] || "Mét";
  }
  if (profile.supplier && data.suppliers.includes(profile.supplier))
    draft.supplier = profile.supplier;
  else if (profile.supplier) {
    draft.supplierMode = "custom";
    draft.supplierCustom = profile.supplier;
  }
  if (profile.customer && data.customers.includes(profile.customer))
    draft.customer = profile.customer;
  else if (profile.customer) {
    draft.customerMode = "custom";
    draft.customerCustom = profile.customer;
  }
  return draft;
}

function materialChoice(i, field, label, options, required) {
  const d = matBatch.drafts[i],
    mode = d[field + "Mode"],
    custom = d[field + "Custom"] || "",
    current = d[field] || "";
  const link = `<button type="button" class="linkish" onclick="materialType(${i},'${field}')">+ Tự gõ</button>`;
  if (mode === "custom")
    return `<div class="form-field"><label>${label}${required ? " *" : ""} ${link}</label><input data-f="${field}Custom" value="${esc(custom)}" maxlength="160" placeholder="Gõ ${label.toLowerCase()}"></div>`;
  const extra =
    field === "group"
      ? '<option value="__custom__">+ Tự gõ nhóm mới khác...</option>'
      : "";
  const empty =
    field === "supplier"
      ? '<option value="">— Chọn nhà cung cấp —</option>'
      : field === "customer"
        ? '<option value="">— (hàng công ty mua)</option>'
        : "";
  return `<div class="form-field"><label>${label}${required ? " *" : ""} ${link}</label><select data-f="${field}" onchange="if(this.value==='__custom__')materialType(${i},'${field}')">${empty}${options.map((x) => `<option ${current === x ? "selected" : ""}>${esc(x)}</option>`).join("")}${extra}</select></div>`;
}

function materialCard(i) {
  const d = matBatch.drafts[i],
    editing = matBatch.edit;
  return `<article class="mat-card" data-mat="${i}"><header><span class="mat-no">${i + 1}</span><b>Nguyên vật liệu #${i + 1}</b><em>${esc(d.groupMode === "custom" ? d.groupCustom || "Nhóm mới" : d.group)}</em><span class="grow"></span>${matBatch.drafts.length > 1 && !editing ? `<button type="button" class="linkish" onclick="materialRemove(${i})">Xóa</button>` : ""}<button type="button" class="btn tiny" onclick="materialDuplicate(${i})">Nhân bản</button><button type="button" class="btn tiny" onclick="materialFold(${i})">${d.open ? "▴" : "▾"}</button></header>${d.open ? `<div class="mat-card-body"><div class="mat-photo-box"><div class="mat-drop" id="mPhotoPreview${i}">${d.photo ? `<img src="${esc(d.photo)}" alt="">` : `<span>Ctrl+V / Chọn<br>ảnh</span>`}</div><div class="mat-photo-actions"><input data-f="photo" type="hidden" value="${esc(d.photo || "")}"><input id="mPhotoFile${i}" type="file" accept="image/jpeg,image/png,image/webp" hidden onchange="materialPhotoRead(${i},this.files[0]);this.value=''"><button class="btn tiny" type="button" onclick="document.getElementById('mPhotoFile${i}').click()">Tải ảnh từ máy</button><button class="btn tiny" type="button" onclick="materialPasteAsk(${i})">Dán ảnh (Ctrl+V)</button><input data-f="photoUrl" placeholder="Hoặc dán đường dẫn hình ảnh (URL)..." onchange="materialPhotoUrl(${i},this.value)"></div></div><p class="hint">Hỗ trợ: Tải file máy tính, bấm nút Dán ảnh hoặc bấm Ctrl+V bắt cứ lúc nào.</p><div class="form-grid"><div class="form-field"><label>Mã nguyên vật liệu</label><input data-f="code" value="${esc(d.code)}" ${editing ? "readonly" : ""} maxlength="80" placeholder="Hệ thống tự cấp khi lưu (NVL-0001, NVL-0002...)"></div><div class="form-field"><label>Tên nguyên vật liệu *</label><input data-f="name" value="${esc(d.name)}" maxlength="200" placeholder="VD: Vải Oxford 900D chống thấm..."></div>${materialChoice(i, "group", "Phân loại nhóm", MAT_GROUPS, true)}${materialChoice(i, "unit", "Đơn vị tính (ĐVT)", MAT_UNITS, true)}${materialChoice(i, "supplier", "Nhà cung cấp chính", data.suppliers, false)}<div class="form-field"><label>Đơn vị mua (tuỳ chọn)</label><input data-f="spec" value="${esc(d.spec)}" maxlength="240" placeholder="VD: cuộn, cây, kg — bỏ trống nếu mua theo ĐVT"></div><div class="form-field"><label>1 đơn vị mua = ? ${esc((d.unitMode === "custom" ? d.unitCustom : d.unit) || "mét").toLowerCase()}</label><input data-f="pack" value="${esc(d.pack)}" maxlength="80" placeholder="VD: 100"></div><div class="form-field"><label>Màu sắc</label><input data-f="color" value="${esc(d.color)}" maxlength="80" placeholder="VD: Đen, Trắng, Khaki, Bạc..."></div><div class="form-field"><label>Quy cách / Khổ</label><input data-f="size_spec" value="${esc(d.size_spec)}" maxlength="120" placeholder="VD: Khổ 1m5, Số 5, 2.5cm..."></div><div class="form-field"><label>Thời gian giao (lead time)</label><input data-f="lead_time" value="${esc(d.lead_time)}" maxlength="80" placeholder="VD: 7-10 ngày, có sẵn"></div><div class="form-field"><label>Đặt tối thiểu (MOQ)</label><input data-f="moq" value="${esc(d.moq)}" maxlength="80" placeholder="VD: 100 mét, 10kg"></div>${materialChoice(i, "customer", "Hàng khách gửi của", data.customers, false)}<div class="form-field"><label>Giá dùng khi chưa có phiếu nhập (đ)</label><input data-f="price" type="number" min="0" value="${esc(d.price)}" placeholder="Để trống nếu chờ nhập kho"><span class="hint">Tuỳ chọn. Chỉ dùng khi mã chưa có phiếu nhập.</span></div><div class="form-field"><label>Tồn tối thiểu (minStock)</label><input data-f="minimum" type="number" min="0" value="${esc(d.minimum)}" placeholder="100"><span class="hint">Ngưỡng cảnh báo cần mua gấp.</span></div><div class="form-field"><label>Tồn hiện tại</label><input data-f="stock" type="number" min="0" step="any" value="${esc(d.stock || "0")}"><span class="hint">Chỉnh khi chưa có phiếu kiểm kê.</span></div><div class="form-field full"><label>Ghi chú</label><textarea data-f="note" maxlength="1000" placeholder="Ghi chú thêm về quy cách, vị trí để hoặc đặc tính nguyên vật liệu...">${esc(d.note)}</textarea></div></div></div>` : ""}</article>`;
}

function materialRender() {
  const box = document.getElementById("matCards");
  if (!box) return;
  box.innerHTML = matBatch.drafts.map((_, i) => materialCard(i)).join("");
  const total = document.getElementById("matTotal");
  if (total)
    total.textContent = `Tổng cộng: ${matBatch.drafts.length} nguyên vật liệu`;
}

function materialSync() {
  if (!matBatch) return;
  document.querySelectorAll("[data-mat]").forEach((card) => {
    const d = matBatch.drafts[Number(card.dataset.mat)];
    if (!d) return;
    card.querySelectorAll("[data-f]").forEach((el) => {
      d[el.dataset.f] = el.value;
    });
  });
}

function materialType(i, field) {
  materialSync();
  const d = matBatch.drafts[i];
  d[field + "Mode"] = d[field + "Mode"] === "custom" ? "list" : "custom";
  materialRender();
}
function materialFold(i) {
  materialSync();
  matBatch.drafts[i].open = !matBatch.drafts[i].open;
  materialRender();
}
function materialRemove(i) {
  materialSync();
  matBatch.drafts.splice(i, 1);
  materialRender();
}
function materialDuplicate(i) {
  materialSync();
  const copy = { ...matBatch.drafts[i], code: "", open: true };
  matBatch.drafts.splice(i + 1, 0, copy);
  materialRender();
}
function materialAdd(n) {
  materialSync();
  for (let k = 0; k < n; k++) matBatch.drafts.push(blankMatDraft());
  materialRender();
}

function materialPhotoRead(i, file) {
  if (!file) return;
  resizeImageData(file)
    .then((value) => {
      materialSync();
      matBatch.drafts[i].photo = value;
      materialRender();
    })
    .catch((e) => toast(e.message || "Không đọc được ảnh này"));
}
function materialPasteAsk(i) {
  matBatch.pasteAt = i;
  toast("Bấm Ctrl+V để dán ảnh vào mã này");
}
async function materialPhotoUrl(i, url) {
  url = String(url || "").trim();
  if (!url) return;
  try {
    let file;
    if (url.startsWith("data:image")) {
      const bin = atob(url.split(",")[1] || "");
      const bytes = new Uint8Array(bin.length);
      for (let n = 0; n < bin.length; n++) bytes[n] = bin.charCodeAt(n);
      file = new File([bytes], "anh", {
        type: url.slice(5, url.indexOf(";")) || "image/png",
      });
    } else {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Không tải được ảnh");
      file = new File([await res.blob()], "anh");
    }
    materialPhotoRead(i, file);
  } catch (e) {
    toast(e.message || "Không dùng được đường dẫn ảnh");
  }
}

function nextMaterialCode(used) {
  let n = 1;
  while (used.has(`NVL-${String(n).padStart(4, "0")}`)) n++;
  return `NVL-${String(n).padStart(4, "0")}`;
}
function materialPicked(d, field) {
  return d[field + "Mode"] === "custom"
    ? String(d[field + "Custom"] || "").trim()
    : String(d[field] || "").trim();
}

function materialModal(code = null) {
  if (currentRole !== "admin")
    return toast("Chỉ quản trị viên mới được sửa danh mục");
  const editing = !!code;
  matBatch = { edit: editing, pasteAt: 0, drafts: [materialDraftFrom(code)] };
  const addBar = editing
    ? ""
    : `<div class="mat-addbar"><button type="button" class="btn" onclick="materialAdd(1)">+ Thêm nguyên vật liệu tiếp theo</button><button type="button" class="btn" onclick="materialAdd(3)">+ 3 mã</button><button type="button" class="btn" onclick="materialAdd(5)">+ 5 mã</button><p class="hint">Mỗi mã đều có thể tải ảnh, dán ảnh Ctrl+V và điền thông số chi tiết độc lập.</p></div>`;
  openModal(
    editing ? "Cập nhật nguyên vật liệu" : "Thêm nguyên vật liệu mới",
    `<p class="hint">Đăng ký một hoặc nhiều mã nguyên vật liệu vào kho với đầy đủ chi tiết và hình ảnh. Mã mới bắt đầu với tồn 0 — có hàng thì lập phiếu nhập hoặc phiếu kiểm kê.</p><div id="matCards"></div>${addBar}`,
    materialSave,
  );
  document
    .querySelector("#modalRoot .modal")
    ?.classList.add("wide", "mat-modal");
  const foot = document.querySelector("#modalRoot .modal-foot");
  if (foot)
    foot.innerHTML = `<span id="matTotal" class="hint"></span><span class="grow"></span><button class="btn" onclick="closeModal()">Hủy bỏ</button><button class="btn primary" id="modalSave">${editing ? "Lưu thông tin" : "+ Tạo nguyên vật liệu"}</button>`;
  document.getElementById("modalSave").onclick = materialSave;
  materialRender();
}

async function materialSave() {
  materialSync();
  const filled = matBatch.drafts.filter((d) =>
    [
      d.code,
      d.name,
      d.photo,
      d.spec,
      d.note,
      d.groupCustom,
      d.supplierCustom,
    ].some((v) => String(v || "").trim()),
  );
  const rows = filled.length ? filled : matBatch.drafts;
  if (!rows.some((d) => d.name.trim()))
    return toast("Nhập tên nguyên vật liệu");
  const used = new Set(data.materials.map((m) => m[0]));
  if (matBatch.edit) used.delete(matBatch.drafts[0].code);
  const prepared = [];
  for (const d of rows) {
    const name = d.name.trim();
    if (!name) return toast("Mỗi mã đang mở cần có tên nguyên vật liệu");
    let id = d.code.trim();
    if (!id) {
      if (matBatch.edit) return toast("Mã nguyên vật liệu không được để trống");
      id = nextMaterialCode(used);
    }
    if (!/^[A-Za-z0-9._/-]{1,80}$/.test(id))
      return toast("Mã NVL chỉ gồm chữ không dấu, số, dấu . _ / -");
    if (used.has(id) || prepared.some((x) => x.id === id))
      return toast("Mã NVL bị trùng: " + id);
    const group = materialPicked(d, "group"),
      unit = materialPicked(d, "unit") || "Cái",
      supplier = materialPicked(d, "supplier"),
      customer = materialPicked(d, "customer");
    if (!group) return toast("Chọn hoặc gõ phân loại nhóm");
    const price = d.price === "" ? 0 : Number(d.price),
      minimum = d.minimum === "" ? 0 : Number(d.minimum),
      stock = d.stock === "" ? 0 : Number(d.stock);
    if (
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isFinite(minimum) ||
      minimum < 0 ||
      !Number.isFinite(stock) ||
      stock < 0
    )
      return toast("Giá, tồn tối thiểu và tồn ban đầu phải là số không âm");
    prepared.push({
      id,
      name,
      group,
      unit,
      supplier,
      customer,
      price,
      minimum,
      stock,
      profile: {
        photo: d.photo || "",
        supplier,
        spec: d.spec.trim(),
        pack: d.pack.trim(),
        color: d.color.trim(),
        size_spec: d.size_spec.trim(),
        lead_time: d.lead_time.trim(),
        moq: d.moq.trim(),
        customer,
        note: d.note.trim(),
      },
    });
    used.add(id);
  }
  data.material_profiles = data.material_profiles || {};
  for (const row of prepared) {
    if (row.supplier && !data.suppliers.includes(row.supplier))
      data.suppliers.push(row.supplier);
    if (row.customer && !data.customers.includes(row.customer))
      data.customers.push(row.customer);
    if (matBatch.edit) {
      const m = data.materials.find((x) => x[0] === matBatch.drafts[0].code);
      const before = qty(m);
      m[1] = row.name;
      m[2] = row.group;
      m[3] = row.unit;
      m[4] = row.stock;
      m[5] = row.minimum;
      m[6] = row.price;
      if (row.stock !== before) {
        const date = todayValue().split("-").reverse().join("/");
        data.ledger.unshift([
          date,
          row.id,
          "Kiểm kê",
          row.stock - before,
          "Sửa hồ sơ",
        ]);
      }
    } else {
      data.materials.unshift([
        row.id,
        row.name,
        row.group,
        row.unit,
        row.stock,
        row.minimum,
        row.price,
      ]);
      if (row.stock) {
        const date = todayValue().split("-").reverse().join("/");
        data.ledger.unshift([
          date,
          row.id,
          "Kiểm kê",
          row.stock,
          "Tồn ban đầu",
        ]);
      }
    }
    data.material_profiles[row.id] = row.profile;
  }
  if (await persist()) {
    closeModal();
    go("materials");
    toast(
      matBatch.edit
        ? "Đã cập nhật nguyên vật liệu"
        : `Đã thêm ${prepared.length} nguyên vật liệu`,
    );
  }
}

document.addEventListener("paste", (e) => {
  if (!document.querySelector("#modalRoot .mat-modal")) return;
  const item = [...(e.clipboardData?.items || [])].find((x) =>
    x.type.startsWith("image/"),
  );
  if (!item) return;
  e.preventDefault();
  const active = document.activeElement?.closest?.("[data-mat]");
  const index = active ? Number(active.dataset.mat) : matBatch?.pasteAt || 0;
  materialPhotoRead(index, item.getAsFile());
});
function editMaterial(code) {
  materialModal(code);
}
