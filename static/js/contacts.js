function contactBadge(text) {
  return `<span class="pill blue">${esc(text)}</span>`;
}
function viewContacts(kind) {
  const sup = kind === "suppliers",
    rows = sup ? data.suppliers : data.customers,
    title = sup ? "Nhà cung cấp" : "Khách hàng";
  const stats = `<div class="grid stats">${stat(sup ? "Tổng nhà cung cấp" : "Tổng khách hàng", rows.length + " đơn vị", "Danh bạ hiện có", "♙")}${stat(sup ? "Phiếu nhập" : "Đơn hàng may", sup ? data.receipts.length + " phiếu" : data.orders.length + " đơn", "Đang lưu trên hệ thống", "▤")}${stat("Đã phát sinh giao dịch", sup ? data.receipts.length + " phiếu" : data.issues.length + " phiếu", "Theo sổ kho", "≡", "green")}${stat("Trạng thái", "Đang hoạt động", "Có thể cập nhật danh bạ", "✓")}</div>`;
  if (sup)
    return `${head(title, "Hồ sơ nhà cung cấp gồm ảnh đại diện, mặt hàng, phân loại và thông tin liên hệ.", `<button class="btn" onclick="supplierCategoryModal()">Quản lý loại NCC</button><button class="btn primary" onclick="contactModal('suppliers')">＋ Thêm nhà cung cấp</button>`)}${stats}<section class="card table-card"><div class="table-toolbar"><h2>Danh bạ nhà cung cấp</h2><input class="field" id="contactSearch" placeholder="⌕ Tìm NCC, mặt hàng, địa chỉ..." oninput="filterSupplierCards()"><div class="supplier-filters"><button class="supplier-category-filter ${supplierFilterCategory === "" ? "active" : ""}" data-category="" onclick="setSupplierCategoryFromButton(this)">Tất cả (${rows.length})</button>${supplierCategories()
      .map(
        (category) =>
          `<button class="supplier-category-filter ${supplierFilterCategory === category ? "active" : ""}" data-category="${esc(category)}" onclick="setSupplierCategoryFromButton(this)">${esc(category)} (${
            rows.filter((name) =>
              (data.supplier_profiles[name]?.categories || "")
                .split(",")
                .map((x) => x.trim())
                .includes(category),
            ).length
          })</button>`,
      )
      .join("")}</div></div><div class="grid supplier-grid" id="supplierRows">${
      rows
        .map((name, i) => {
          const p = data.supplier_profiles[name] || {},
            tags = (p.categories || "")
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
            docs = data.receipts.filter((r) => r[2] === name).length;
          return `<article class="card supplier-card" data-categories="${esc(p.categories || "")}"><div class="supplier-card-head"><div class="supplier-photo">${p.logo ? `<img src="${esc(p.logo)}" alt="Ảnh ${esc(name)}">` : esc(name.slice(0, 2).toUpperCase())}</div><div><div class="supplier-tags">${tags.map(contactBadge).join("")}${p.short_code ? contactBadge(p.short_code) : ""}</div><h3>${esc(name)}</h3><div class="supplier-subtitle">${esc(p.products || "Chưa khai báo mặt hàng cung cấp")}</div></div>${currentRole === "admin" ? `<div class="supplier-actions"><button title="Sửa hồ sơ" onclick="contactModal('suppliers',${i})">✎</button><button class="delete" title="Xóa nhà cung cấp" onclick="removeContact('suppliers',${i})">×</button></div>` : ""}</div><div class="supplier-info"><div>☎ ${esc(p.phone || "Chưa có số điện thoại")}${p.messenger ? ` · ${esc(p.messenger)}` : ""}</div><div>⌖ ${esc(p.address || "Chưa có địa chỉ")}</div><div>◉ Nguồn tìm kiếm: ${esc(p.source || "—")}</div><div>◈ Đơn giá: ${esc(p.currency || "VND")}${p.exchange_rate && p.currency && p.currency !== "VND" ? ` · Tỷ giá ${esc(p.exchange_rate)}` : ""}${p.delivery_days ? ` · Giao hàng ${esc(p.delivery_days)} ngày` : ""}${p.foreign_price && p.exchange_rate ? ` · Giá quy đổi ${money(Number(p.foreign_price) * Number(p.exchange_rate))}` : ""}</div></div><div class="supplier-products"><div class="supplier-products-head"><b>▧ SẢN PHẨM NGUỒN HÀNG (${(data.supplier_products?.[name] || []).length})</b>${currentRole === "admin" ? `<button class="btn small" onclick="supplierProductModalByCard(this)" data-supplier="${esc(name)}">＋ Thêm sản phẩm</button>` : ""}</div>${renderSupplierProducts(name)}<span class="subtle">${docs} phiếu nhập${p.note ? ` · ${esc(p.note)}` : ""}</span></div></article>`;
        })
        .join("") ||
      '<div class="empty-state" style="grid-column:1/-1">Chưa có nhà cung cấp. Thêm hồ sơ hoặc nhập danh bạ để bắt đầu.</div>'
    }</div></section>`;
  return `${head(title, "Danh bạ khách hàng phục vụ lập phiếu xuất và đơn hàng may.", `<button class="btn primary" onclick="contactModal('${kind}')">＋ Thêm khách hàng</button>`)}${stats}<section class="card table-card"><div class="table-toolbar"><div class="tabs"><button class="tab" onclick="go('suppliers')">Nhà cung cấp</button><button class="tab active" onclick="go('customers')">Khách hàng</button></div><div class="top-spacer"></div><input class="field" id="contactSearch" placeholder="⌕ Tìm tên..." oninput="filterSimple('contactSearch','contactRows')"></div><div class="table-wrap"><table><thead><tr><th>TÊN KHÁCH HÀNG</th><th>SỐ PHIẾU XUẤT</th><th>SỐ ĐƠN</th><th>THAO TÁC</th></tr></thead><tbody id="contactRows">${rows
    .map((x, i) => {
      const docs = data.issues.filter((r) => r[2] === x).length,
        orders = data.orders.filter((o) => o[1] === x).length;
      return `<tr><td class="primary-text">${esc(x)}</td><td>${docs}</td><td>${orders}</td><td>${currentRole === "admin" ? `<button class="link-button" onclick="contactModal('${kind}',${i})">Sửa tên</button><span class="subtle"> · </span><button class="link-button" onclick="removeContact('${kind}',${i})">Xóa</button>` : ""}</td></tr>`;
    })
    .join("")}</tbody></table></div></section>`;
}
function setSupplierCategoryFromButton(button) {
  supplierFilterCategory = button.dataset.category || "";
  document
    .querySelectorAll(".supplier-category-filter")
    .forEach((x) => x.classList.toggle("active", x === button));
  filterSupplierCards();
}
function filterSupplierCards() {
  const q = (document.getElementById("contactSearch")?.value || "")
    .trim()
    .toLocaleLowerCase("vi");
  document.querySelectorAll("#supplierRows .supplier-card").forEach((card) => {
    const cats = (card.dataset.categories || "")
      .split(",")
      .map((x) => x.trim());
    card.hidden =
      !card.textContent.toLocaleLowerCase("vi").includes(q) ||
      (supplierFilterCategory && !cats.includes(supplierFilterCategory));
  });
}
function updateSupplierVndPrice() {
  const price = Number(
      document.getElementById("supplierForeignPrice")?.value || 0,
    ),
    rate = Number(document.getElementById("supplierExchangeRate")?.value || 0),
    out = document.getElementById("supplierVndPrice");
  if (out) out.textContent = price > 0 && rate > 0 ? money(price * rate) : "—";
}
function supplierLogoSet(value) {
  const box = document.getElementById("supplierLogoPreview");
  if (!box) return;
  box.innerHTML = value
    ? `<img src="${esc(value)}" alt="Ảnh đại diện nhà cung cấp">`
    : "<span>Ảnh<br>logo</span>";
  const field = document.getElementById("supplierLogoData");
  if (field) field.value = value;
}
async function supplierLogoRead(file) {
  if (!file) return;
  try {
    supplierLogoSet(await resizeImageData(file));
  } catch (e) {
    toast(e.message || "Không đọc được ảnh này");
  }
}
function supplierLogoPaste(event) {
  const item = [...(event.clipboardData?.items || [])].find((x) =>
    x.type.startsWith("image/"),
  );
  if (!item) return;
  event.preventDefault();
  supplierLogoRead(item.getAsFile());
}

async function supplierProductPhotoRead(file) {
  if (!file) return;
  try {
    const value = await resizeImageData(file);
    document.getElementById("supplierProductPhotoData").value = value;
    document.getElementById("supplierProductPhotoPreview").innerHTML = value
      ? `<img src="${esc(value)}" alt="Ảnh sản phẩm">`
      : "Ảnh sản phẩm";
  } catch (e) {
    toast(e.message || "Không đọc được ảnh này");
  }
}
function renderSupplierProducts(name) {
  const items = data.supplier_products?.[name] || [];
  if (!items.length)
    return '<div class="empty-state compact-empty">Chưa lưu sản phẩm hoặc mẫu vải nào từ nhà cung cấp này.</div>';
  return `<div class="supplier-product-list">${items.map((item, i) => `<div class="supplier-product-row"><div class="supplier-product-thumb">${item.photo ? `<img src="${esc(item.photo)}" alt="${esc(item.name)}">` : "▧"}</div><div class="supplier-product-main"><b>${esc(item.name)}</b><small>${esc(item.unit || "")}${item.price ? ` · ${data.supplier_profiles?.[name]?.currency === "VND" || !data.supplier_profiles?.[name]?.currency ? money(item.price) : `${Number(item.price).toLocaleString("vi-VN")} ${esc(data.supplier_profiles[name].currency)}`}` : ""}${item.note ? ` · ${esc(item.note)}` : ""}</small></div>${currentRole === "admin" ? `<button class="link-button" onclick="supplierProductModalByCard(this)" data-supplier="${esc(name)}" data-index="${i}">Sửa</button><button class="link-button danger-link" onclick="removeSupplierProductByCard(this)" data-supplier="${esc(name)}" data-index="${i}">Xóa</button>` : ""}</div>`).join("")}</div>`;
}
function supplierProductModalByCard(button) {
  supplierProductModal(
    button.dataset.supplier,
    button.dataset.index === "" || button.dataset.index === undefined
      ? null
      : Number(button.dataset.index),
  );
}
function removeSupplierProductByCard(button) {
  if (currentRole !== "admin")
    return toast("Chỉ quản trị viên mới được sửa danh bạ");
  const name = button.dataset.supplier,
    index = Number(button.dataset.index),
    items = data.supplier_products?.[name] || [];
  if (!items[index]) return toast("Không tìm thấy sản phẩm");
  if (!confirm(`Xóa sản phẩm ${items[index].name}?`)) return;
  items.splice(index, 1);
  if (!items.length) delete data.supplier_products[name];
  persist().then((ok) => {
    if (ok) {
      render();
      toast("Đã xóa sản phẩm nhà cung cấp");
    }
  });
}
function supplierProductModal(name, index = null) {
  if (currentRole !== "admin")
    return toast("Chỉ quản trị viên mới được sửa danh bạ");
  if (!data.suppliers.includes(name))
    return toast("Không tìm thấy nhà cung cấp");
  const items = data.supplier_products[name] || [],
    old = index === null ? null : items[index];
  openModal(
    `${old ? "Sửa" : "Thêm"} sản phẩm nguồn hàng`,
    `<div class="form-grid"><div class="form-field full"><label>Ảnh sản phẩm / mẫu vải</label><div class="supplier-product-upload"><div id="supplierProductPhotoPreview" class="supplier-product-thumb large">${old?.photo ? `<img src="${esc(old.photo)}" alt="${esc(old.name)}">` : "▧"}</div><input id="supplierProductPhotoData" type="hidden" value="${esc(old?.photo || "")}"><input type="file" accept="image/jpeg,image/png,image/webp" hidden id="supplierProductPhotoFile" onchange="supplierProductPhotoRead(this.files[0]);this.value=''"><button class="btn" type="button" onclick="document.getElementById('supplierProductPhotoFile').click()">⇧ Tải ảnh từ máy</button></div></div><div class="form-field full"><label>Tên sản phẩm / mẫu *</label><input id="supplierProductName" maxlength="160" value="${esc(old?.name || "")}" placeholder="Ví dụ: Vải lót mã A12"></div><div class="form-field"><label>Đơn vị</label><input id="supplierProductUnit" maxlength="40" value="${esc(old?.unit || "")}" placeholder="mét, cuộn, cái..."></div><div class="form-field"><label>Giá tham khảo (${esc(data.supplier_profiles?.[name]?.currency || "VND")})</label><input id="supplierProductPrice" type="number" min="0" step="any" value="${esc(old?.price ?? "")}"></div><div class="form-field full"><label>Ghi chú / mã mẫu</label><input id="supplierProductNote" maxlength="1000" value="${esc(old?.note || "")}" placeholder="Mã màu, khổ vải, quy cách..."></div></div>`,
    async () => {
      const productName = document
          .getElementById("supplierProductName")
          .value.trim(),
        rawPrice = document.getElementById("supplierProductPrice").value,
        price = rawPrice === "" ? 0 : Number(rawPrice);
      if (!productName) return toast("Vui lòng nhập tên sản phẩm hoặc mẫu");
      if (!Number.isFinite(price) || price < 0)
        return toast("Giá tham khảo phải là số không âm");
      const item = {
        id: old?.id || makeId("NCCSP-"),
        name: productName,
        unit: document.getElementById("supplierProductUnit").value.trim(),
        price,
        note: document.getElementById("supplierProductNote").value.trim(),
        photo: document.getElementById("supplierProductPhotoData").value,
      };
      data.supplier_products[name] = items;
      if (index === null) items.unshift(item);
      else items[index] = item;
      if (await persist()) {
        closeModal();
        go("suppliers");
        toast("Đã lưu sản phẩm nguồn hàng");
      }
    },
  );
}
function contactModal(kind, index = null) {
  if (currentRole !== "admin")
    return toast("Chỉ quản trị viên mới được sửa danh mục");
  const sup = kind === "suppliers",
    arr = sup ? data.suppliers : data.customers,
    old = index === null ? "" : arr[index],
    profile = sup && old ? data.supplier_profiles[old] || {} : {};
  if (!sup) {
    openModal(
      `${old ? "Đổi tên" : "Thêm"} khách hàng`,
      `<div class="form-field"><label>Tên khách hàng *</label><input id="contactName" value="${esc(old)}" placeholder="Nhập tên" maxlength="160"></div>`,
      async () => {
        const n = document.getElementById("contactName").value.trim();
        if (!n) return toast("Vui lòng nhập tên");
        if (arr.some((x, i) => x === n && i !== index))
          return toast("Tên này đã có trong danh bạ");
        if (index === null) arr.push(n);
        else {
          arr[index] = n;
          data.issues.forEach((r) => {
            if (r[2] === old) r[2] = n;
          });
          data.orders.forEach((r) => {
            if (r[1] === old) r[1] = n;
          });
          for (const profile of Object.values(data.material_profiles || {}))
            if (profile.customer === old) profile.customer = n;
        }
        if (await persist()) {
          closeModal();
          go(kind);
          toast("Đã cập nhật danh bạ");
        }
      },
    );
    return;
  }
  openModal(
    `${old ? "Sửa hồ sơ" : "Thêm"} nhà cung cấp`,
    `<div class="form-field full"><label>Ảnh đại diện / logo / nhà xưởng</label><div class="supplier-form-photo" tabindex="0" onpaste="supplierLogoPaste(event)" onclick="this.focus()"><div class="supplier-photo" id="supplierLogoPreview">${profile.logo ? `<img src="${esc(profile.logo)}" alt="Ảnh nhà cung cấp">` : "<span>Ảnh<br>logo</span>"}</div><div><input id="supplierLogoData" type="hidden" value="${esc(profile.logo || "")}"><input id="supplierLogoFile" type="file" accept="image/jpeg,image/png,image/webp" hidden onchange="supplierLogoRead(this.files[0]);this.value=''"><button type="button" class="btn" onclick="document.getElementById('supplierLogoFile').click()">⇧ Tải ảnh từ máy</button><p class="hint">Ảnh được nén và lưu cùng hồ sơ. Có thể bấm Ctrl+V khi vùng này đang được chọn.</p></div></div></div><div class="form-grid"><div class="form-field full"><label>Tên nhà cung cấp *</label><input id="contactName" value="${esc(old)}" placeholder="Ví dụ: Công ty Dệt May..." maxlength="160"></div><div class="form-field"><label>Mã viết tắt</label><input id="supplierShortCode" value="${esc(profile.short_code || "")}" maxlength="40" placeholder="VD: QLQ, CHITHANH"></div><div class="form-field"><label>Mặt hàng cung cấp</label><input id="supplierProducts" value="${esc(profile.products || "")}" maxlength="240" placeholder="Ví dụ: Vải tuyết mưa, khóa kéo..."></div><div class="form-field full"><label>Loại nhà cung cấp</label><input id="supplierCategories" value="${esc(profile.categories || "")}" maxlength="240" placeholder="NCC vải denim, NCC da, NCC lót..."><span class="hint">Nhập nhiều loại, phân cách bằng dấu phẩy.</span></div><div class="form-field"><label>Số điện thoại</label><input id="supplierPhone" value="${esc(profile.phone || "")}" maxlength="80" placeholder="Ví dụ: 0908 123 456"></div><div class="form-field"><label>Zalo / người liên hệ</label><input id="supplierMessenger" value="${esc(profile.messenger || "")}" maxlength="120" placeholder="Ví dụ: Zalo 0908... (Anh Tuấn)"></div><div class="form-field full"><label>Địa chỉ xưởng / kho / văn phòng</label><input id="supplierAddress" value="${esc(profile.address || "")}" maxlength="240" placeholder="Địa chỉ giao dịch"></div><div class="form-field full"><label>Nguồn tìm kiếm</label><input id="supplierSource" value="${esc(profile.source || "")}" maxlength="160" placeholder="Đối tác, chợ, hội chợ..."></div><div class="form-field"><label>Đơn vị giá / tiền tệ</label><input id="supplierCurrency" value="${esc(profile.currency || "VND")}" maxlength="20" placeholder="VND, USD, CNY"></div><div class="form-field"><label>Giá tiền nước ngoài</label><input id="supplierForeignPrice" value="${esc(profile.foreign_price || "")}" maxlength="40" placeholder="1" oninput="updateSupplierVndPrice()"></div><div class="form-field"><label>Tỷ giá quy đổi sang VND</label><input id="supplierExchangeRate" type="number" min="0.000001" step="any" value="${esc(profile.exchange_rate || "1")}" placeholder="1" oninput="updateSupplierVndPrice()"></div><div class="form-field full"><label>Giá Việt Nam (tự chuyển đổi)</label><output id="supplierVndPrice" class="supplier-vnd-price">${profile.foreign_price && profile.exchange_rate ? money(Number(profile.foreign_price) * Number(profile.exchange_rate)) : "—"}</output></div><div class="form-field"><label>Giao trung bình (ngày)</label><input id="supplierDeliveryDays" type="number" min="0" step="1" value="${esc(profile.delivery_days || "")}" placeholder="3"></div><div class="form-field full"><label>Ghi chú nhà cung cấp</label><textarea id="supplierNote" maxlength="1000" placeholder="Điều khoản công nợ, đánh giá độ uy tín...">${esc(profile.note || "")}</textarea></div></div>`,
    async () => {
      const n = document.getElementById("contactName").value.trim();
      if (!n) return toast("Vui lòng nhập tên nhà cung cấp");
      if (arr.some((x, i) => x === n && i !== index))
        return toast("Tên này đã có trong danh bạ");
      const exchange = document.getElementById("supplierExchangeRate").value,
        delivery = document.getElementById("supplierDeliveryDays").value;
      if (
        exchange &&
        (Number(exchange) <= 0 || !Number.isFinite(Number(exchange)))
      )
        return toast("Tỷ giá cần là số lớn hơn 0");
      if (
        delivery &&
        (Number(delivery) < 0 || !Number.isInteger(Number(delivery)))
      )
        return toast("Số ngày giao cần là số nguyên không âm");
      const next = {
        logo: document.getElementById("supplierLogoData").value,
        short_code: document.getElementById("supplierShortCode").value.trim(),
        products: document.getElementById("supplierProducts").value.trim(),
        categories: document
          .getElementById("supplierCategories")
          .value.split(",")
          .map((x) => x.trim())
          .filter(Boolean)
          .join(", "),
        phone: document.getElementById("supplierPhone").value.trim(),
        messenger: document.getElementById("supplierMessenger").value.trim(),
        address: document.getElementById("supplierAddress").value.trim(),
        source: document.getElementById("supplierSource").value.trim(),
        currency:
          document.getElementById("supplierCurrency").value.trim() || "VND",
        foreign_price: document
          .getElementById("supplierForeignPrice")
          .value.trim(),
        exchange_rate: exchange || "1",
        delivery_days: delivery,
        note: document.getElementById("supplierNote").value.trim(),
      };
      if (index === null) arr.push(n);
      else if (old !== n) {
        arr[index] = n;
        data.receipts.forEach((r) => {
          r[2] = String(r[2] || "")
            .split(", ")
            .map((x) => (x === old ? n : x))
            .join(", ");
        });
        for (const profile of Object.values(data.material_profiles || {}))
          if (profile.supplier === old) profile.supplier = n;
        for (const detail of Object.values(data.doc_details || {}))
          for (const line of detail.lines || [])
            if (line.supplier === old) line.supplier = n;
        delete data.supplier_profiles[old];
        data.supplier_products[n] = data.supplier_products[old] || [];
        delete data.supplier_products[old];
      }
      data.supplier_profiles[n] = next;
      data.supplier_categories = data.supplier_categories || [];
      for (const category of next.categories
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean))
        if (!data.supplier_categories.includes(category))
          data.supplier_categories.push(category);
      if (await persist()) {
        closeModal();
        go("suppliers");
        toast("Đã lưu hồ sơ nhà cung cấp");
      }
    },
  );
}
function supplierCategories() {
  const listed = data.supplier_categories || [],
    used = Object.values(data.supplier_profiles || {}).flatMap((p) =>
      (p.categories || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    );
  return [...new Set([...listed, ...used])].sort((a, b) =>
    a.localeCompare(b, "vi"),
  );
}
function supplierCategoryModal() {
  if (currentRole !== "admin")
    return toast("Chỉ quản trị viên mới được sửa danh mục");
  const categories = supplierCategories();
  openModal(
    "Quản lý loại nhà cung cấp",
    `<p class="hint">Mỗi nhà cung cấp có thể thuộc nhiều loại. Xóa một loại sẽ gỡ loại đó khỏi các hồ sơ đang dùng.</p><div class="line-item"><input class="field" id="supplierCategoryNew" maxlength="80" placeholder="VD: NCC khuôn, NCC chỉ may"><button type="button" class="btn" onclick="addSupplierCategory()">＋ Thêm loại</button></div><div class="table-wrap"><table><thead><tr><th>LOẠI NHÀ CUNG CẤP</th><th>SỐ NCC</th><th></th></tr></thead><tbody>${
      categories
        .map(
          (c) =>
            `<tr><td>${esc(c)}</td><td>${
              data.suppliers.filter((n) =>
                (data.supplier_profiles[n]?.categories || "")
                  .split(",")
                  .map((x) => x.trim())
                  .includes(c),
              ).length
            }</td><td><button class="link-button" ${act("renameSupplierCategory", c)}>Sửa</button> · <button class="link-button" ${act("deleteSupplierCategory", c)}>Xóa</button></td></tr>`,
        )
        .join("") || '<tr><td colspan="3">Chưa có loại nhà cung cấp.</td></tr>'
    }</tbody></table></div>`,
  );
}
async function addSupplierCategory() {
  const name = document.getElementById("supplierCategoryNew").value.trim();
  if (!name) return toast("Nhập tên loại nhà cung cấp");
  if (
    supplierCategories().some(
      (x) => x.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"),
    )
  )
    return toast("Loại nhà cung cấp đã tồn tại");
  data.supplier_categories = [...supplierCategories(), name];
  if (await persist()) {
    render();
    supplierCategoryModal();
    toast("Đã thêm loại nhà cung cấp");
  }
}
function renameSupplierCategory(old) {
  openModal(
    "Sửa loại nhà cung cấp",
    `<div class="form-field"><label>Tên loại</label><input id="supplierCategoryRename" maxlength="80" value="${esc(old)}"></div>`,
    async () => {
      const name = document
        .getElementById("supplierCategoryRename")
        .value.trim();
      if (!name) return toast("Nhập tên loại");
      if (
        supplierCategories().some(
          (x) =>
            x !== old &&
            x.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"),
        )
      )
        return toast("Loại nhà cung cấp đã tồn tại");
      data.supplier_categories = supplierCategories().map((x) =>
        x === old ? name : x,
      );
      for (const profile of Object.values(data.supplier_profiles)) {
        profile.categories = (profile.categories || "")
          .split(",")
          .map((x) => (x.trim() === old ? name : x.trim()))
          .filter(Boolean)
          .join(", ");
      }
      if (await persist()) {
        render();
        supplierCategoryModal();
        toast("Đã đổi tên loại nhà cung cấp");
      }
    },
  );
}
async function deleteSupplierCategory(name) {
  if (!confirm(`Xóa loại "${name}" và gỡ khỏi hồ sơ nhà cung cấp?`)) return;
  data.supplier_categories = supplierCategories().filter((x) => x !== name);
  for (const profile of Object.values(data.supplier_profiles)) {
    profile.categories = (profile.categories || "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x && x !== name)
      .join(", ");
  }
  if (await persist()) {
    render();
    supplierCategoryModal();
    toast("Đã xóa loại nhà cung cấp");
  }
}
async function removeContact(kind, index) {
  if (currentRole !== "admin")
    return toast("Chỉ quản trị viên mới được sửa danh mục");
  const arr = kind === "suppliers" ? data.suppliers : data.customers;
  const n = arr[index];
  const profiles = Object.values(data.material_profiles || {});
  const linked =
    kind === "suppliers"
      ? data.receipts.some((r) => String(r[2] || "").split(", ").includes(n)) ||
        Object.values(data.doc_details || {}).some((d) =>
          (d.lines || []).some((line) => line.supplier === n),
        )
      : data.issues.some((r) => r[2] === n) ||
        data.orders.some((r) => r[1] === n);
  if (linked)
    return toast(
      "Không thể xóa vì danh bạ này đã được dùng trong phiếu/đơn hàng. Có thể đổi tên thay vì xóa.",
    );
  if (profiles.some((p) => p[kind === "suppliers" ? "supplier" : "customer"] === n))
    return toast(
      "Không thể xóa vì đang được gán trên hồ sơ nguyên vật liệu. Hãy bỏ gán trên hồ sơ NVL trước.",
    );
  if (!confirm(`Xóa ${n} khỏi danh bạ?`)) return;
  arr.splice(index, 1);
  if (kind === "suppliers") {
    delete data.supplier_profiles[n];
    delete data.supplier_products?.[n];
  }
  if (await persist()) {
    render();
    toast("Đã xóa khỏi danh bạ");
  }
}
