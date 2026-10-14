function makeId(prefix) {
  return (
    prefix +
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random().toString(36).slice(2, 8).toUpperCase()
  );
}
function todayValue() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}
function qty(m) {
  return Number(m[4]) || 0;
}
function status(m) {
  return qty(m) <= 0 || qty(m) <= m[5]
    ? "Cần mua gấp"
    : qty(m) < m[5] * 1.5
      ? "Sắp hết"
      : "Đủ hàng";
}
function money(n) {
  return Number(n || 0).toLocaleString("vi-VN") + " ₫";
}
function totalStock() {
  return data.materials.reduce((s, m) => s + qty(m) * Number(m[6] || 0), 0);
}
function esc(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function toast(msg) {
  const t = document.getElementById("toastRoot");
  t.innerHTML = `<div class="toast">✓ &nbsp;${esc(msg)}</div>`;
  setTimeout(() => (t.innerHTML = ""), 2600);
}

function head(title, desc, buttons = "") {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${desc}</p></div><div class="actions">${buttons}</div></div>`;
}
function stat(label, value, foot, icon, color = "") {
  return `<div class="card stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div><span class="stat-icon ${color}">${icon}</span></div>`;
}
function badge(text) {
  const c =
    text === "Đủ hàng"
      ? ""
      : text === "Sắp hết"
        ? "warn"
        : text === "Cần mua gấp"
          ? "red"
          : text === "Hoàn thành"
            ? ""
            : "blue";
  return `<span class="pill ${c}"><i class="dot"></i>${esc(text)}</span>`;
}

async function resizeImageData(file) {
  if (!file) return "";
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw Error("Ảnh cần là JPEG, PNG hoặc WebP");
  if (file.size > 8_000_000) throw Error("Ảnh gốc tối đa 8 MB");
  const img = new Image(),
    url = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    const canvas = document.createElement("canvas"),
      ctx = canvas.getContext("2d");
    let side = 480,
      quality = 0.72,
      value = "";
    for (let n = 0; n < 12; n++) {
      const scale = Math.min(
        1,
        side / Math.max(img.naturalWidth, img.naturalHeight),
      );
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      value = canvas.toDataURL("image/jpeg", quality);
      if (value.length <= 43700) return value;
      quality -= 0.1;
      if (quality < 0.45) {
        quality = 0.62;
        side = Math.round(side * 0.75);
      }
    }
    throw Error("Ảnh vẫn quá lớn sau khi nén, hãy chọn ảnh khác");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function openModal(title, body, onSave) {
  document.getElementById("modalRoot").innerHTML =
    `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><section class="modal" role="dialog"><div class="modal-head"><h2>${title}</h2><button onclick="closeModal()">×</button></div><div class="modal-body">${body}</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Hủy</button>${onSave ? `<button class="btn primary" id="modalSave">Lưu thông tin</button>` : `<button class="btn primary" onclick="closeModal()">Đóng</button>`}</div></section></div>`;
  if (onSave) document.getElementById("modalSave").onclick = onSave;
}
function closeModal() {
  document.getElementById("modalRoot").innerHTML = "";
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// Click handlers that need stored data (codes, ids, names) carry it in data-*
// attributes, HTML-escaped by esc(), and are dispatched here. Text from the
// database is never placed inside inline JavaScript, where &#39; would decode
// back into a quote and end the string.
const clickActions = new Set([
  "deleteSupplierCategory",
  "deleteUser",
  "docModal",
  "editMaterial",
  "materialDetail",
  "removeDoc",
  "renameSupplierCategory",
  "showCountDetails",
  "showDocDetails",
  "showDocHistory",
  "showOrderDetails",
  "toggleOrderStatus",
]);
function act(name, ...args) {
  return `data-act="${esc(name)}" data-args="${esc(JSON.stringify(args))}"`;
}
function actClose(name, ...args) {
  return `${act(name, ...args)} data-close-modal`;
}
document.addEventListener("click", (event) => {
  const el = event.target.closest?.("[data-act]");
  if (!el || !clickActions.has(el.dataset.act)) return;
  if (el.hasAttribute("data-close-modal")) closeModal();
  globalThis[el.dataset.act](...JSON.parse(el.dataset.args || "[]"));
});
