const navGroups = [
  ["TỔNG QUAN", [["dashboard", "▦", "Bảng điều khiển"]]],
  [
    "NGHIỆP VỤ KHO",
    [
      ["materials", "▤", "Danh mục NVL"],
      ["count", "☷", "Kiểm kê kho"],
      ["receipts", "↙", "Nhập kho từ NCC"],
      ["issues", "↗", "Xuất kho & Cấp phát"],
      ["orders", "▣", "Đơn hàng may"],
      ["ledger", "≡", "Sổ kho"],
    ],
  ],
  [
    "DANH BẠ",
    [
      ["suppliers", "♙", "Nhà cung cấp"],
      ["customers", "♧", "Khách hàng"],
    ],
  ],
  ["HỆ THỐNG", [["settings", "⚙", "Cài đặt"]]],
];
let data = {
  materials: [],
  receipts: [],
  issues: [],
  orders: [],
  suppliers: [],
  supplier_profiles: {},
  supplier_categories: [],
  supplier_products: {},
  doc_details: {},
  order_details: {},
  customers: [],
  ledger: [],
  counts: [],
};
let currentUser = "";
let currentRole = "warehouse";
let stateVersion = 0;
let setupRequiresToken = false;
let saving = Promise.resolve();
let page = "dashboard";
let materialFilter = "Tất cả";
let supplierFilterCategory = "";
// Reloads server data after a failed save. Returns false when the session is
// gone (the login screen is shown instead).
async function reloadState() {
  const r = await fetch("/api/state", { cache: "no-store" });
  if (r.status === 401) {
    renderAuth(true, "Phiên đăng nhập đã hết hạn. Thay đổi vừa rồi CHƯA được lưu.");
    return false;
  }
  if (!r.ok) throw Error("Không tải lại được dữ liệu");
  const fresh = await r.json();
  data = fresh.data;
  stateVersion = fresh.version;
  render();
  return true;
}
function persist() {
  saving = saving
    .then(async () => {
      const r = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, version: stateVersion }),
      });
      const result = await r.json().catch(() => ({}));
      if (r.status === 409) {
        if (await reloadState())
          toast(
            "CHƯA LƯU: người khác vừa lưu dữ liệu. Dữ liệu mới nhất đã được tải lại — hãy kiểm tra và nhập lại thay đổi.",
          );
        return false;
      }
      if (r.status === 401) {
        renderAuth(true, "Phiên đăng nhập đã hết hạn. Thay đổi vừa rồi CHƯA được lưu.");
        return false;
      }
      if (!r.ok) throw Error(result.error || "Không lưu được dữ liệu");
      stateVersion = result.version;
      return true;
    })
    .catch(async (e) => {
      const message =
        e instanceof TypeError ? "mất kết nối tới máy chủ" : e.message;
      try {
        if (!(await reloadState())) return false;
      } catch {}
      toast(`CHƯA LƯU: ${message || "Không lưu được dữ liệu"}`);
      return false;
    });
  return saving;
}
async function startApp() {
  try {
    const r = await fetch("/api/auth/status", { cache: "no-store" });
    const s = await r.json();
    setupRequiresToken = s.setup_requires_token;
    if (s.authenticated) {
      await enterApp(s.username);
    } else renderAuth(s.configured, "", setupRequiresToken);
  } catch (e) {
    console.error(e);
    document.getElementById("shell").style.display = "none";
    document.getElementById("authRoot").innerHTML =
      `<div class="auth-screen"><div class="auth-card"><h1>Không kết nối được backend</h1><p>${esc(e.message || "Hãy kiểm tra máy chủ rồi tải lại trang.")}</p></div></div>`;
  }
}
function renderAuth(configured, error = "", requiresToken = false) {
  document.getElementById("shell").style.display = "none";
  document.getElementById("authRoot").innerHTML =
    `<div class="auth-screen"><section class="auth-card"><div class="auth-brand"><div class="logo">H</div><div><b>HOÀNG NHẬT SCM</b><small>HỆ THỐNG QUẢN LÝ KHO &amp; CHUỖI CUNG ỨNG</small></div></div><h1>${configured ? "Đăng nhập hệ thống" : "Thiết lập quản trị viên"}</h1><p>${configured ? "Đăng nhập để quản lý kho, phiếu nhập xuất và đơn hàng." : "Tạo tài khoản quản trị đầu tiên. Mật khẩu được băm và lưu trong database của hệ thống."}</p><form onsubmit="submitAuth(event,${configured})"><div class="form-field"><label>Tên đăng nhập</label><input id="authUsername" required minlength="3" maxlength="60" autocomplete="username" placeholder="Tên đăng nhập"></div><div class="form-field"><label>Mật khẩu</label><input id="authPassword" type="password" required minlength="${configured ? "1" : "12"}" autocomplete="${configured ? "current-password" : "new-password"}" placeholder="${configured ? "Nhập mật khẩu" : "Ít nhất 12 ký tự"}"></div>${!configured && requiresToken ? `<div class="form-field"><label>Mã thiết lập do quản trị hệ thống cung cấp</label><input id="setupToken" required autocomplete="off" placeholder="Mã thiết lập"></div>` : ""}${configured ? "" : `<div class="form-field"><label>Nhập lại mật khẩu</label><input id="authConfirm" type="password" required minlength="12" autocomplete="new-password" placeholder="Nhập lại mật khẩu"></div>`}<div id="authError" class="auth-error" style="${error ? "display:block" : ""}">${esc(error)}</div><button class="btn primary" type="submit" style="width:100%;margin-top:10px">${configured ? "Đăng nhập" : "Tạo tài khoản quản trị"}</button></form><div class="auth-help">Phiên làm việc hết hạn sau 12 giờ · Dữ liệu lưu trong database của hệ thống</div></section></div>`;
}
async function submitAuth(event, configured) {
  event.preventDefault();
  const username = document.getElementById("authUsername").value.trim(),
    password = document.getElementById("authPassword").value;
  if (!configured && password !== document.getElementById("authConfirm").value)
    return renderAuth(false, "Hai mật khẩu chưa khớp");
  try {
    const r = await fetch(configured ? "/api/auth/login" : "/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        ...(!configured && setupRequiresToken
          ? { setup_token: document.getElementById("setupToken").value }
          : {}),
      }),
    });
    const result = await r.json();
    if (!r.ok)
      return renderAuth(
        configured,
        result.error || "Đăng nhập không thành công",
        setupRequiresToken,
      );
    await enterApp(result.username);
  } catch (e) {
    console.error(e);
    renderAuth(configured, e.message || "Không kết nối được máy chủ");
  }
}
async function enterApp(username) {
  const r = await fetch("/api/state", { cache: "no-store" });
  if (!r.ok) {
    renderAuth(true, "Không tải được dữ liệu hệ thống");
    return;
  }
  const result = await r.json();
  data = result.data;
  data.supplier_profiles = data.supplier_profiles || {};
  data.material_profiles = data.material_profiles || {};
  data.supplier_products = data.supplier_products || {};
  data.doc_details = data.doc_details || {};
  data.order_details = data.order_details || {};
  data.supplier_categories =
    data.supplier_categories ||
    [
      ...new Set(
        Object.values(data.supplier_profiles).flatMap((p) =>
          (p.categories || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ),
    ].sort((a, b) => a.localeCompare(b, "vi"));
  data.counts = data.counts || [];
  stateVersion = result.version;
  currentUser = result.username || username;
  currentRole = result.role || "warehouse";
  document.getElementById("authRoot").innerHTML = "";
  document.getElementById("shell").style.display = "flex";
  const name = document.querySelector(".profile .who b");
  if (name) name.textContent = currentUser;
  const initials =
    currentRole === "admin" ? "QV" : currentUser.slice(0, 2).toUpperCase();
  document.getElementById("profileAvatar").textContent = initials;
  document.getElementById("menuAvatar").textContent = initials;
  document.getElementById("profileName").textContent = currentUser;
  document.getElementById("menuName").textContent = currentUser;
  document.getElementById("menuLogin").textContent = "@" + currentUser;
  const roleLabel = currentRole === "admin" ? "Quản trị viên" : "Nhân viên kho";
  document.getElementById("profileRole").textContent = roleLabel;
  document.getElementById("menuRole").textContent = roleLabel;
  renderNav();
  render();
}
function toggleProfileMenu(event) {
  event?.stopPropagation();
  const menu = document.getElementById("profileMenu"),
    button = document.getElementById("profileButton");
  const open = menu.hidden;
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}
function closeProfileMenu() {
  const menu = document.getElementById("profileMenu"),
    button = document.getElementById("profileButton");
  if (menu) menu.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
}
document.addEventListener("click", (event) => {
  if (!event.target.closest(".profile-wrap")) closeProfileMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeProfileMenu();
});
async function logout() {
  await fetch("/api/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  currentUser = "";
  renderAuth(true);
}

function renderNav() {
  document.getElementById("nav").innerHTML = navGroups
    .map(
      ([g, items]) =>
        `<section class="nav-group"><div class="nav-title">${g}</div>${items.map(([id, ico, label]) => `<button class="nav-link ${page === id ? "active" : ""}" onclick="go('${id}')"><span class="ico">${ico}</span>${label}${["materials", "receipts", "issues", "orders", "suppliers"].includes(id) ? `<span class="count">${{ materials: data.materials.length, receipts: data.receipts.length, issues: data.issues.length, orders: data.orders.length, suppliers: data.suppliers.length }[id]}</span>` : ""}</button>`).join("")}</section>`,
    )
    .join("");
}
function go(p) {
  page = p;
  renderNav();
  render();
  document.getElementById("sidebar").classList.remove("open");
  window.scrollTo(0, 0);
}
function toggleNav() {
  document.getElementById("sidebar").classList.toggle("open");
}

function render() {
  renderNav();
  const root = document.getElementById("app");
  const views = {
    dashboard: viewDashboard,
    materials: viewMaterials,
    count: viewCount,
    receipts: () => viewDocs("receipts"),
    issues: () => viewDocs("issues"),
    orders: viewOrders,
    ledger: viewLedger,
    suppliers: () => viewContacts("suppliers"),
    customers: () => viewContacts("customers"),
    settings: viewSettings,
  };
  root.innerHTML = (views[page] || viewDashboard)();
  if (page === "settings") {
    const box = document.getElementById("userManagement");
    if (currentRole !== "admin") box.style.display = "none";
    else loadUsers();
  }
}
