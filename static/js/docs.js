function viewDocs(kind) {
  const incoming = kind === "receipts",
    rows = incoming ? data.receipts : data.issues,
    title = incoming ? "Nhập kho" : "Xuất kho",
    c1 = incoming ? "Phiếu nhập" : "Phiếu xuất",
    val = incoming
      ? rows.reduce((s, r) => s + (Number(r[4]) || 0), 0)
      : rows.reduce((s, r) => s + r[5], 0),
    now = new Date(),
    monthRows = rows.filter((r) => {
      const d = parseLocalDate(r[1]);
      return (
        !Number.isNaN(d.valueOf()) &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
      );
    });
  return `${head(title, "Mỗi hàng là một phiếu " + (incoming ? "nhập" : "xuất") + "; lọc, xem và lập phiếu mới.", `<button class="btn primary" onclick="docModal('${kind}')">＋ Lập phiếu ${incoming ? "nhập" : "xuất"}</button>`)}<div class="grid stats">${stat(c1, rows.length + " phiếu", "Tất cả phiếu", "▣")}${stat("Dòng nguyên vật liệu", rows.reduce((s, r) => s + (incoming ? r[3] : r[5]), 0) + " dòng", "Tổng hợp", "≡", "green")}${stat(incoming ? "Tổng tiền nhập" : "Khách hàng", incoming ? money(val) : new Set(rows.map((r) => r[2])).size + " khách", incoming ? "Theo đơn giá nhập" : "Có phát sinh", "◈", "amber")}${stat("Phiếu trong tháng", monthRows.length + " phiếu", "Tháng hiện tại", "◷")}</div><section class="card table-card"><div class="table-toolbar"><h2>Danh sách phiếu ${incoming ? "nhập" : "xuất"} kho</h2><input id="docSearch" class="field" placeholder="⌕ Tìm phiếu" oninput="filterTable('docSearch','docRows')"><select class="select" id="docParty" onchange="filterTable('docSearch','docRows')"><option value="">Tất cả ${incoming ? "nhà cung cấp" : "khách hàng"}</option>${(incoming ? data.suppliers : data.customers).map((x) => `<option>${esc(x)}</option>`).join("")}</select><input class="field" id="docMonth" type="month" aria-label="Lọc theo tháng" onchange="filterTable('docSearch','docRows')"></div><div class="table-wrap"><table><thead><tr><th>MÃ PHIẾU</th><th>NGÀY</th><th>${incoming ? "NGUỒN HÀNG" : "KHÁCH HÀNG"}</th>${incoming ? "" : "<th>ĐƠN HÀNG MAY</th><th>LOẠI XUẤT</th>"}<th>SỐ DÒNG</th>${incoming ? "<th>TỔNG TIỀN</th>" : ""}<th>NGƯỜI LẬP</th><th></th></tr></thead><tbody id="docRows">${rows
    .map(
      (r) =>
        `<tr data-party="${esc(r[2])}" data-month="${(() => {
          const d = parseLocalDate(r[1]);
          return Number.isNaN(d.valueOf())
            ? ""
            : d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        })()}"><td class="code">${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td>${incoming ? "" : `<td>${esc(r[3])}</td><td>${esc(r[4])}</td>`}<td>${incoming ? r[3] : r[5]}</td>${incoming ? `<td>${money(r[4])}</td>` : ""}<td>${esc(currentUser)}</td><td><button class="link-button" ${act("showDocDetails", r[0], kind)}>Chi tiết</button></td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></div><div class="table-toolbar"><span class="subtle">${rows.length} phiếu · Dữ liệu đã ghi trong hệ thống</span></div></section>`;
}
function documentLines(id, row, incoming) {
  const saved = data.doc_details?.[id]?.lines;
  if (saved?.length) return saved;
  return data.ledger
    .filter((x) => x[4] === id)
    .map((x) => ({
      code: x[1],
      qty: Math.abs(Number(x[3])),
      unit_price: 0,
      supplier: incoming ? row[2] : "",
    }));
}
function documentPostStock(id, code) {
  const first = data.ledger.findIndex((x) => x[4] === id);
  const newer =
    first < 0
      ? 0
      : data.ledger
          .slice(0, first)
          .filter((x) => x[1] === code)
          .reduce((sum, x) => sum + Number(x[3]), 0);
  const m = data.materials.find((x) => x[0] === code);
  return (m ? qty(m) : 0) - newer;
}
function showDocDetails(id, kind) {
  const incoming = kind === "receipts",
    row = (incoming ? data.receipts : data.issues).find((r) => r[0] === id);
  if (!row) return toast("Không tìm thấy phiếu");
  const detail = data.doc_details?.[id] || {},
    lines = documentLines(id, row, incoming),
    title = incoming ? "Phiếu nhập kho" : "Phiếu xuất kho";
  document.getElementById("modalRoot").innerHTML =
    `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><section class="modal" role="dialog"><div class="modal-head"><div><h2>${title} · ${esc(id)}</h2><p>${incoming ? "Phiếu nhập kho" : "Phiếu xuất kho"} · ngày ${esc(row[1])}</p></div><button onclick="closeModal()">×</button></div><div class="modal-body"><div class="doc-summary"><div><small>Mã phiếu</small><b>${esc(id)}</b></div><div><small>Ngày phiếu</small><b>${esc(row[1])}</b></div><div><small>${incoming ? "Nguồn hàng" : "Khách hàng"}</small><b>${esc(row[2] || "—")}</b></div><div><small>Người lập</small><b>${esc(detail.created_by || "—")}</b></div>${!incoming ? `<div><small>Đơn hàng</small><b>${esc(row[3] || "—")}</b></div><div><small>Loại xuất</small><b>${esc(row[4] || "—")}</b></div>` : ""}<div class="full"><small>Ghi chú</small><b>${esc(detail.note || "—")}</b></div></div><div class="tabs"><button class="tab active" ${act("showDocDetails", id, kind)}>Dòng NVL</button><button class="tab" ${act("showDocHistory", id, kind)}>Lịch sử sửa (${detail.history?.length || 0})</button></div><div class="table-wrap"><table><thead><tr><th>#</th><th>Mã NVL</th><th>Tên NVL</th><th>ĐVT</th><th>Số lượng</th>${incoming ? "<th>Đơn giá</th><th>Thành tiền</th><th>Nguồn hàng</th>" : ""}<th>Tồn sau</th></tr></thead><tbody>${
      lines
        .map((line, i) => {
          const m = data.materials.find((z) => z[0] === line.code);
          return `<tr><td>${i + 1}</td><td class="code">${esc(line.code)}</td><td>${esc(m?.[1] || "NVL đã xóa")}</td><td>${esc(m?.[3] || "")}</td><td>${Number(line.qty).toLocaleString("vi-VN")}</td>${incoming ? `<td>${money(line.unit_price)}</td><td>${money(line.qty * line.unit_price)}</td><td>${esc(line.supplier || row[2] || "—")}</td>` : ""}<td>${documentPostStock(id, line.code).toLocaleString("vi-VN")}</td></tr>`;
        })
        .join("") ||
      '<tr><td colspan="9">Không còn dòng chi tiết trong sổ kho.</td></tr>'
    }</tbody></table></div>${incoming ? `<p class="doc-total"><b>Tổng tiền:</b> ${money(row[4])}</p>` : ""}</div><div class="modal-foot">${currentRole === "admin" ? `<button class="btn danger" ${act("removeDoc", id, kind)}>Xóa phiếu</button><button class="btn" ${actClose("docModal", kind, id)}>✎ Sửa phiếu</button>` : ""}<div class="top-spacer"></div><button class="btn primary" onclick="closeModal()">Đóng</button></div></section></div>`;
}
function showDocHistory(id, kind) {
  const meta = data.doc_details?.[id] || {},
    events = meta.history || [];
  openModal(
    `Lịch sử sửa · ${id}`,
    `${events.length ? `<div class="table-wrap"><table><thead><tr><th>THỜI ĐIỂM</th><th>NGƯỜI SỬA</th><th>THAY ĐỔI</th><th>NGÀY PHIẾU</th><th>SỐ DÒNG</th><th>GHI CHÚ TRƯỚC ĐÓ</th></tr></thead><tbody>${events.map((event) => `<tr><td>${esc(new Date(event.at).toLocaleString("vi-VN"))}</td><td>${esc(event.by)}</td><td>${esc(event.action)}</td><td>${esc(event.date)}</td><td>${event.lines.length}</td><td>${esc(event.note || "—")}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-state">Phiếu chưa có lần sửa nào.</div>'}`,
  );
}
function filterTable(searchId, rowsId) {
  const q = document.getElementById(searchId).value.toLowerCase(),
    p = document.getElementById("docParty").value,
    month = document.getElementById("docMonth").value;
  document
    .querySelectorAll(`#${rowsId} tr`)
    .forEach(
      (r) =>
        (r.hidden = !(
          r.textContent.toLowerCase().includes(q) &&
          (!p || r.dataset.party === p) &&
          (!month || r.dataset.month === month)
        )),
    );
}
function docModal(kind, docId = null) {
  const incoming = kind === "receipts",
    rows = incoming ? data.receipts : data.issues,
    existing = docId ? rows.find((r) => r[0] === docId) : null;
  if (docId && (!existing || currentRole !== "admin"))
    return toast("Không có quyền sửa phiếu này");
  const oldMeta = docId ? data.doc_details?.[docId] || {} : {},
    savedLines = docId ? documentLines(docId, existing, incoming) : [],
    parsed = existing ? parseLocalDate(existing[1]) : new Date(),
    dateValue = Number.isNaN(parsed.valueOf())
      ? todayValue()
      : `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`,
    primaryParty = incoming
      ? data.suppliers.includes(existing?.[2])
        ? existing[2]
        : ""
      : existing?.[2] || "",
    orderValue = existing && !incoming ? existing[3] : "";
  openModal(
    `${existing ? "Sửa" : "Lập"} phiếu ${incoming ? "nhập" : "xuất"} kho`,
    `<div class="form-grid"><div class="form-field"><label>Ngày phiếu *</label><input type="date" id="docDate" value="${dateValue}"></div><div class="form-field"><label>${incoming ? "Nguồn hàng chính" : "Loại xuất"}</label>${incoming ? `<select id="docPartyInput"><option value="">Chọn nguồn hàng (có thể chọn theo từng dòng)</option>${data.suppliers.map((x) => `<option ${x === primaryParty ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>` : `<select id="docType"><option ${existing?.[4] === "Xuất gia công" ? "selected" : ""}>Xuất gia công</option><option ${existing?.[4] === "Xuất bán hàng" ? "selected" : ""}>Xuất bán hàng</option>${existing && !["Xuất gia công", "Xuất bán hàng"].includes(existing[4]) ? `<option selected>${esc(existing[4])}</option>` : ""}</select>`}</div>${incoming ? "" : `<div class="form-field"><label>Khách hàng *</label><select id="docPartyInput"><option value="">Chọn khách hàng</option>${data.customers.map((x) => `<option ${x === primaryParty ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div><div class="form-field"><label>Đơn hàng liên quan</label><select id="issueOrder"><option value="">Không gắn đơn</option>${data.orders.map((o) => `<option value="${esc(o[0])}" ${o[0] === orderValue ? "selected" : ""}>${esc(o[0])} · ${esc(o[1])}</option>`).join("")}</select></div>`}<div class="form-field full"><label>Dòng nguyên vật liệu</label><div id="lines"></div><button type="button" class="btn small" onclick="addLine('${kind}')">＋ Thêm dòng</button><span class="hint">${incoming ? "Số lượng × đơn giá sẽ cộng vào tồn kho. Chọn nguồn hàng cho từng dòng nếu phiếu có nhiều nhà cung cấp." : "Số lượng xuất sẽ trừ tồn kho."}</span></div><div class="form-field full"><label>Ghi chú phiếu</label><textarea id="docNote" maxlength="2000">${esc(oldMeta.note || "")}</textarea></div></div>`,
    () => saveDoc(kind, docId),
  );
  document.getElementById("modalSave").textContent = existing
    ? "Lưu phiếu"
    : "Lập phiếu";
  if (savedLines.length)
    savedLines.forEach((line) => addLine(kind, line, primaryParty));
  else addLine(kind, null, primaryParty);
}
function addLine(kind, initial = null, defaultSupplier = "") {
  const box = document.getElementById("lines");
  const supplier = initial?.supplier || defaultSupplier;
  box.insertAdjacentHTML(
    "beforeend",
    `<div class="line-item"><select class="line-mat"><option value="">Chọn NVL</option>${data.materials.map((m) => `<option value="${esc(m[0])}" ${initial?.code === m[0] ? "selected" : ""}>${esc(m[0])} · ${esc(m[1])} (${qty(m)} ${esc(m[3])})</option>`).join("")}</select><input class="line-qty" type="number" min="0.01" step="any" placeholder="Số lượng" value="${initial ? esc(initial.qty) : ""}">${kind === "receipts" ? `<input class="line-price" type="number" min="0" step="any" placeholder="Đơn giá" value="${initial ? esc(initial.unit_price) : ""}"><select class="line-supplier"><option value="">Nguồn hàng</option>${data.suppliers.map((x) => `<option ${x === supplier ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>` : ""}<button class="btn small danger del-line" onclick="this.parentElement.remove()">Xóa</button></div>`,
  );
}
async function saveDoc(kind, docId = null) {
  const incoming = kind === "receipts",
    rows = incoming ? data.receipts : data.issues,
    existing = docId ? rows.find((r) => r[0] === docId) : null;
  if (docId && currentRole !== "admin")
    return toast("Chỉ quản trị viên mới được sửa phiếu cũ");
  const partyField = document.getElementById("docPartyInput"),
    defaultParty = partyField?.value || "",
    rawLines = [...document.querySelectorAll(".line-item")],
    lines = [];
  for (const el of rawLines) {
    const code = el.querySelector(".line-mat").value,
      rawQty = el.querySelector(".line-qty").value,
      amount = Number(rawQty),
      price = Number(el.querySelector(".line-price")?.value || 0),
      supplier = el.querySelector(".line-supplier")?.value || defaultParty;
    if (!code || !rawQty || !Number.isFinite(amount) || amount <= 0)
      return toast("Mỗi dòng cần chọn NVL và nhập số lượng hợp lệ");
    if (!Number.isFinite(price) || price < 0)
      return toast("Đơn giá cần là số không âm");
    if (incoming && !supplier)
      return toast("Chọn nhà cung cấp cho từng dòng nhập");
    lines.push({
      code,
      qty: amount,
      unit_price: price,
      supplier: incoming ? supplier : "",
    });
  }
  if (!lines.length) return toast("Thêm ít nhất một dòng hợp lệ");
  let party = incoming
    ? [...new Set(lines.map((x) => x.supplier))].join(", ")
    : defaultParty;
  if (!incoming && !party) return toast("Vui lòng chọn khách hàng");
  const order = !incoming
      ? document.getElementById("issueOrder")?.value || ""
      : "",
    linkedOrder = order ? data.orders.find((o) => o[0] === order) : null;
  if (linkedOrder && linkedOrder[1] !== party)
    return toast("Khách hàng trên phiếu phải trùng khách hàng của đơn hàng");
  if (linkedOrder) {
    const allowanceError = issueExceedsOrderAllowance(order, lines, docId);
    if (allowanceError) return toast(allowanceError);
  }
  const rawDate = document.getElementById("docDate").value;
  if (!rawDate) return toast("Vui lòng chọn ngày phiếu");
  const date = rawDate.split("-").reverse().join("/"),
    id = docId || makeId(incoming ? "PNK-" : "PXK-"),
    oldEvents = docId ? data.ledger.filter((r) => r[4] === id) : [],
    oldDelta = new Map(),
    newDelta = new Map();
  oldEvents.forEach((r) =>
    oldDelta.set(r[1], (oldDelta.get(r[1]) || 0) + Number(r[3])),
  );
  lines.forEach((line) =>
    newDelta.set(
      line.code,
      (newDelta.get(line.code) || 0) + (incoming ? line.qty : -line.qty),
    ),
  );
  const codes = new Set([...oldDelta.keys(), ...newDelta.keys()]);
  for (const code of codes) {
    const m = data.materials.find((x) => x[0] === code);
    if (!m) return toast(`Không tìm thấy mã NVL ${code}`);
    const next = qty(m) - (oldDelta.get(code) || 0) + (newDelta.get(code) || 0);
    if (!incoming && next < -1e-8)
      return toast("Số lượng xuất vượt tồn hiện có");
    if (next < 0) return toast("Sửa phiếu sẽ làm tồn kho âm");
  }
  if (
    !incoming &&
    lines.some((x) => !data.materials.some((m) => m[0] === x.code))
  )
    return toast("Mã NVL không tồn tại");
  const note = document.getElementById("docNote").value.trim(),
    oldMeta = docId ? data.doc_details?.[id] || {} : {},
    history = oldMeta.history || [];
  if (existing) {
    history.unshift({
      at: new Date().toISOString(),
      by: currentUser,
      action: "Sửa phiếu",
      date: existing[1],
      party: existing[2],
      kind: incoming ? "Nhập" : "Xuất",
      note: oldMeta.note || "",
      lines: documentLines(id, existing, incoming),
    });
    if (history.length > 100) history.length = 100;
  }
  for (const code of codes) {
    const m = data.materials.find((x) => x[0] === code);
    m[4] = qty(m) - (oldDelta.get(code) || 0) + (newDelta.get(code) || 0);
  }
  data.ledger = data.ledger.filter((r) => r[4] !== id);
  for (const line of lines) {
    if (incoming && line.unit_price > 0) {
      const m = data.materials.find((x) => x[0] === line.code);
      m[6] = line.unit_price;
    }
    data.ledger.unshift([
      date,
      line.code,
      incoming ? "Nhập" : "Xuất",
      incoming ? line.qty : -line.qty,
      id,
    ]);
  }
  data.doc_details = data.doc_details || {};
  data.doc_details[id] = {
    note,
    created_by: existing ? oldMeta.created_by || currentUser : currentUser,
    lines,
    history,
  };
  if (incoming) {
    const sum = lines.reduce((s, x) => s + x.qty * x.unit_price, 0),
      next = [id, date, party, lines.length, sum];
    if (existing) rows[rows.indexOf(existing)] = next;
    else rows.unshift(next);
  } else {
    const next = [
      id,
      date,
      party,
      order || "—",
      document.getElementById("docType").value,
      lines.length,
    ];
    if (existing) {
      rows[rows.indexOf(existing)] = next;
      const oldOrder =
        existing[3] !== "—"
          ? data.orders.find((o) => o[0] === existing[3])
          : null;
      if (oldOrder && existing[3] !== next[3])
        oldOrder[5] = String(Math.max(0, Number(oldOrder[5] || 0) - 1));
    } else rows.unshift(next);
    if (linkedOrder && (!existing || existing[3] !== next[3]))
      linkedOrder[5] = String(Number(linkedOrder[5] || 0) + 1);
  }
  if (await persist()) {
    closeModal();
    if (existing) {
      render();
      showDocDetails(id, kind);
      toast("Đã cập nhật phiếu");
    } else {
      go(kind);
      toast("Đã lưu phiếu thành công");
    }
  }
}
function removeDoc(id, kind) {
  if (currentRole !== "admin")
    return toast("Chỉ quản trị viên mới được xóa phiếu");
  if (
    !confirm(
      `Xóa phiếu ${id}? Tồn kho sẽ được điều chỉnh ngược lại theo phiếu.`,
    )
  )
    return;
  const incoming = kind === "receipts",
    rows = incoming ? data.receipts : data.issues,
    row = rows.find((x) => x[0] === id);
  if (!row) return toast("Không tìm thấy phiếu");
  const events = data.ledger.filter((x) => x[4] === id),
    delta = new Map();
  events.forEach((x) => delta.set(x[1], (delta.get(x[1]) || 0) + Number(x[3])));
  for (const [code, value] of delta) {
    const m = data.materials.find((x) => x[0] === code);
    if (!m || qty(m) - value < -1e-8)
      return toast(
        "Không thể xóa phiếu: tồn kho sẽ bị âm. Hãy đối chiếu các phiếu sau trước.",
      );
  }
  for (const [code, value] of delta) {
    const m = data.materials.find((x) => x[0] === code);
    m[4] = qty(m) - value;
  }
  data.ledger = data.ledger.filter((x) => x[4] !== id);
  rows.splice(rows.indexOf(row), 1);
  if (!incoming && row[3] !== "—") {
    const order = data.orders.find((x) => x[0] === row[3]);
    if (order) order[5] = String(Math.max(0, Number(order[5] || 0) - 1));
  }
  if (data.doc_details) delete data.doc_details[id];
  closeModal();
  persist().then((ok) => {
    if (ok) {
      render();
      toast(`Đã xóa phiếu ${id}`);
    }
  });
}
