# 📐 Sơ Đồ Hệ Thống Hoàng Nhật SCM Dashboard

> **Lưu ý (14/10/2026):** tài liệu này viết cho phiên bản cũ (backend Python `server.py`, triển khai Render/PostgreSQL). Kiến trúc hiện tại (Node.js/TypeScript, Prisma + SQLite, Docker Compose + Caddy trên EC2) xem `README.md` và `docs/DEPLOY.md`. Phần mô tả chức năng nghiệp vụ vẫn còn giá trị tham khảo.

---

## 1. Sơ đồ Kiến trúc Tổng quan

```mermaid
flowchart TD
    subgraph Client["🖥️ Frontend (React SPA)"]
        Browser["Browser"]
        ReactApp["React App"]
        Router["React Router v6"]
        RQ["TanStack React Query"]
        RHF["React Hook Form"]
        ApiClient["API Client (Xe object)"]
        SocketClient["Socket.IO Client"]
    end

    subgraph Server["⚙️ Backend API (Same-origin)"]
        API["/api/v1 REST API"]
        AuthMW["Auth Middleware\n(JWT + API Key)"]
        EncryptMW["Encrypt Middleware\n(AES optional)"]
        AuthModule["Auth Module"]
        MatModule["Materials Module"]
        InvModule["Inventory Module"]
        VoucherModule["Vouchers Module"]
        OrderModule["Production Orders"]
        SupModule["Suppliers Module"]
        AdminModule["Admin Module"]
        GiaVonModule["Giá Vốn Module"]
        DashModule["Dashboard Module"]
        SocketServer["Socket.IO Server"]
    end

    subgraph External["☁️ External Services"]
        Cloudinary["Cloudinary\n(Image CDN)"]
        DB[("Database")]
    end

    Browser --> ReactApp
    ReactApp --> Router
    Router --> RQ
    RQ --> ApiClient
    ReactApp --> RHF
    ApiClient -->|"x-api-key + Bearer JWT"| API
    ReactApp --> SocketClient
    SocketClient --> SocketServer

    API --> AuthMW --> EncryptMW
    EncryptMW --> AuthModule
    EncryptMW --> MatModule
    EncryptMW --> InvModule
    EncryptMW --> VoucherModule
    EncryptMW --> OrderModule
    EncryptMW --> SupModule
    EncryptMW --> AdminModule
    EncryptMW --> GiaVonModule
    EncryptMW --> DashModule

    MatModule --> DB
    InvModule --> DB
    VoucherModule --> DB
    OrderModule --> DB
    SupModule --> DB
    AdminModule --> DB
    GiaVonModule --> DB
    DashModule --> DB

    ApiClient -->|"POST /upload/image"| Cloudinary
```

---

## 2. Luồng Authentication

```mermaid
sequenceDiagram
    actor User
    participant Login as Trang Login
    participant Auth as AuthProvider
    participant API as /api/v1/auth
    participant Storage as localStorage

    alt Đăng nhập Username/Password
        User->>Login: Nhập username + password
        Login->>API: POST /auth/login<br/>{ username, password }<br/>Headers: x-api-key, x-encrypt-response
        API-->>Login: { accessToken, refreshToken, user }
    else Đăng nhập Badge QR
        User->>Login: Quét QR thẻ nhân viên
        Login->>API: POST /auth/badge-login<br/>{ badgeId, pin }
        API-->>Login: { accessToken, refreshToken, user }
    end

    Login->>Auth: Lưu user info
    Auth->>Storage: hn_access_token<br/>hn_refresh_token<br/>hn_auth_user

    Note over Auth,API: Khi token hết hạn (1h)

    Auth->>API: POST /auth/refresh-token<br/>{ refreshToken }
    API-->>Auth: { new accessToken }

    Note over Auth,API: Khi đăng xuất

    User->>Auth: Logout
    Auth->>API: POST /auth/logout
    Auth->>Storage: Xóa tokens
```

---

## 3. Luồng Nghiệp vụ Chính

### 3.1 Luồng Nhập Kho

```mermaid
flowchart LR
    A["📝 Tạo Phiếu Nhập\n(POST /vouchers)"] --> B["📋 Chọn NCC\n(Nguồn nhập)"]
    B --> C["📦 Thêm dòng NVL\n(materialCode, qty, unitPrice)"]
    C --> D["✅ Lưu phiếu\nMã: PNK-YYMMDD-xxx"]
    D --> E["📊 Tự động tạo\nGiao dịch kho\n(inQty +)"]
    E --> F["📈 Cập nhật\ntồn kho NVL\n(currentStock ↑)"]
    F --> G["💰 Tính giá vốn\n(giaVonTb, giaVonDv)"]
```

### 3.2 Luồng Xuất Kho

```mermaid
flowchart LR
    A["📝 Tạo Phiếu Xuất\n(POST /vouchers)"] --> B["🏭 Chọn Đơn May\nhoặc Khách hàng"]
    B --> C["📦 Thêm dòng NVL\n(materialCode, qty)"]
    C --> D["✅ Lưu phiếu\nMã: PXK-YYMMDD-xxx"]
    D --> E["📊 Tự động tạo\nGiao dịch kho\n(outQty +)"]
    E --> F["📉 Cập nhật\ntồn kho NVL\n(currentStock ↓)"]
    F --> G{"stockStatus?"}
    G -->|"≥ minStock"| H["🟢 OK"]
    G -->|"< minStock"| I["🟡 Cảnh báo"]
    G -->|"= 0"| J["🔴 Hết hàng"]
```

### 3.3 Luồng Đơn May & BOM

```mermaid
flowchart TD
    A["📋 Tạo Đơn May\n(POST /production-orders)"] --> B["📐 Thiết lập Định mức BOM\n(PUT /:id/dinh-muc)"]
    B --> C["🔢 Cập nhật SL đơn\n(PATCH /:id/sl-don)"]
    C --> D["📊 Set % Hao hụt\n(PATCH /:id/hao-hut)"]
    D --> E["➕ Bổ sung NVL\n(PATCH /:id/bo-sung)"]
    E --> F["📦 Xuất kho theo BOM\n(Tạo phiếu xuất)"]
    F --> G{"Đủ NVL?"}
    G -->|"Có"| H["✅ Hoàn thành\n(POST /:id/complete)"]
    G -->|"Thiếu"| I["⚠️ overNormOrders\n(Vượt định mức)"]
    H --> J["🔓 Có thể mở lại\n(POST /:id/uncomplete)"]
```

### 3.4 Luồng Giá Vốn

```mermaid
flowchart TD
    A["📊 Xem trạng thái\n(GET /gia-von/trang-thai)"] --> B{"Đã bật?"}
    B -->|"Chưa"| C["⚡ Bật giá vốn\n(POST /gia-von/bat)"]
    B -->|"Rồi"| D["🔍 Đối chiếu\n(GET /gia-von/doi-chieu)"]
    C --> D
    D --> E["📋 Danh sách:\ncode, tonKho, tongLo,\nchenh, giaTriLo, thieuGia"]
    E --> F{"Có chênh lệch?"}
    F -->|"Có"| G["🔄 Định giá lại\n(POST /gia-von/dinh-gia-lai)\n{ ma: [...codes], chayThu: bool }"]
    F -->|"Không"| H["✅ Khớp"]
    G -->|"chayThu: true"| I["🧪 Chạy thử"]
    G -->|"chayThu: false"| J["✅ Áp dụng thật"]
```

---

## 4. Sơ đồ Chức năng (Feature Map)

```mermaid
flowchart TD
    Root["🏠 Hoàng Nhật SCM\ndashboard.hoang-nhat.com"]

    Root --> Login["🔐 Đăng nhập\n/login"]
    Root --> Dashboard["📊 Dashboard\n/"]
    Root --> Kho["📦 Kho\n/kho"]
    Root --> NhapKho["📥 Nhập kho\n/nhap-kho"]
    Root --> XuatKho["📤 Xuất kho\n/xuat-kho"]
    Root --> SoKho["📒 Sổ kho\n/so-kho"]
    Root --> DanhMuc["🗂️ Danh mục NVL\n/danh-muc-nvl"]
    Root --> DonMay["🧵 Đơn may\n/don-may"]
    Root --> NCC["🏭 Nhà cung cấp\n/nha-cung-cap"]
    Root --> KH["👥 Khách hàng\n/khach-hang"]
    Root --> CaiDat["⚙️ Cài đặt\n/cai-dat"]

    Login --> L1["Username / Password"]
    Login --> L2["Badge QR + PIN"]

    Dashboard --> D1["KPI tổng hợp"]
    Dashboard --> D2["Biểu đồ xu hướng"]
    Dashboard --> D3["Phân bổ theo danh mục"]
    Dashboard --> D4["Đơn vượt định mức"]
    Dashboard --> D5["Phiếu chưa hoàn tất"]

    Kho --> K1["Xem tồn kho"]
    Kho --> K2["Lọc: OK / Cảnh báo / Hết"]
    Kho --> K3["Kiểm kê\n/kho/kiem-ke"]

    NhapKho --> N1["Tạo phiếu nhập"]
    NhapKho --> N2["Chọn NCC nguồn"]
    NhapKho --> N3["Thêm dòng NVL + giá"]
    NhapKho --> N4["Xem lịch sử phiếu"]

    XuatKho --> X1["Tạo phiếu xuất"]
    XuatKho --> X2["Xuất theo đơn may"]
    XuatKho --> X3["Xuất cho khách"]

    SoKho --> S1["Sổ kho tổng hợp"]
    SoKho --> S2["Lọc theo kỳ/NVL"]
    SoKho --> S3["Xuất Excel"]

    DanhMuc --> DM1["CRUD nguyên vật liệu"]
    DanhMuc --> DM2["Import Excel hàng loạt"]
    DanhMuc --> DM3["Upload ảnh Cloudinary"]
    DanhMuc --> DM4["Quản lý danh mục"]
    DanhMuc --> DM5["Gán NCC mặc định"]

    DonMay --> DO1["Tạo đơn may mới"]
    DonMay --> DO2["Chi tiết /don-may/:id"]
    DO2 --> DO3["Thiết lập BOM"]
    DO2 --> DO4["Set SL đơn + hao hụt"]
    DO2 --> DO5["Bổ sung NVL"]
    DO2 --> DO6["Hoàn thành / Mở lại"]

    NCC --> NC1["CRUD nhà cung cấp"]
    NCC --> NC2["NCC Trung Quốc"]
    NCC --> NC3["Phân loại NCC (12 loại)"]
    NCC --> NC4["Đánh giá NCC"]

    KH --> KH1["CRUD khách hàng"]
    KH --> KH2["Mã rút gọn (shortCode)"]

    CaiDat --> CD1["Quản lý Users"]
    CaiDat --> CD2["Cấp / Thu hồi Badge PIN"]
    CaiDat --> CD3["Reset mật khẩu user"]
    CaiDat --> CD4["Đổi mật khẩu cá nhân"]
    CaiDat --> CD5["Giá vốn (bật/tắt/đối chiếu)"]
    CaiDat --> CD6["Chất lượng dữ liệu"]
```

---

## 5. ER Diagram (Quan hệ dữ liệu)

```mermaid
erDiagram
    USER {
        string id PK "u_admin"
        string badgeId "HN-EMP-ADMIN"
        string username
        string fullName
        string role "admin | kho | ..."
        string department
        string email
        boolean isActive
        boolean hasBadgePin
    }

    MATERIAL {
        string id PK "mat_xxx"
        string code "NVL-0077"
        string name
        string category "BAO BÌ"
        string uom "tờ, mét, cái..."
        string sizeSpec
        string color
        string storageLocation "Kệ A1"
        string imageUrl
        string supplierName
        float latestPrice
        int minStock
        int currentStock
        string stockStatus "ok | warn | danger"
        float stockValue
        float giaVonTb
        string defaultSupplierId FK
        timestamp createdAt
        timestamp updatedAt
    }

    SUPPLIER {
        string id PK "sup_xxx"
        string name
        string imageUrl
        string country
        string countryCode
        string contactPerson
        string phone
        string chatApp
        string address
        string mainProducts
        string sourcingChannel
        string currency
        float exchangeRate
        string loaiNcc
        string partnerType
        int leadTime
    }

    SUPPLIER_TYPE {
        string id PK
        string name
        int soNcc
    }

    CATEGORY {
        string name PK
    }

    CUSTOMER {
        string id PK "kh_xxx"
        string name "CHÂU FIFTH"
        string shortCode "C5"
    }

    VOUCHER {
        string id PK "phieu_xxx"
        string code "PNK-261012-005"
        string type "nhap | xuat"
        date voucherDate
        string tonKhoKind
        boolean incomplete
        string missingInfo
        string customerId FK
        string customerName
        string productionOrderId FK
        string issueKind
        string receivingUnit
        string receivingStaff
        string note
        int lineCount
        float totalQty
        float totalAmount
        string createdBy FK
        timestamp createdAt
        string updatedBy FK
        timestamp updatedAt
    }

    TRANSACTION {
        string id PK "dong_xxx"
        string voucherId FK
        string voucherCode
        int lineNo
        date transactionDate
        string monthPeriod
        string type "in | out"
        string materialCode FK
        string materialName
        string category
        string color
        string uom
        float inQty
        float outQty
        float balanceAfter
        float unitPriceSnapshot
        float amountSnapshot
        float giaVon
        float giaVonDv
        string sourceKind
        string sourceId
        string createdBy FK
    }

    PRODUCTION_ORDER {
        string id PK
        string code
        string customerName
        int orderQty
        float wastePercent
        string status "open | completed"
        timestamp createdAt
    }

    BOM_LINE {
        string productionOrderId FK
        string materialCode FK
        float normQty
        float actualQty
    }

    GIA_VON {
        string code FK
        string uom
        float tonKho
        float tongLo
        float chenh
        float giaTriLo
        boolean thieuGia
    }

    MATERIAL ||--o{ TRANSACTION : "có nhiều giao dịch"
    MATERIAL }o--|| SUPPLIER : "NCC mặc định"
    MATERIAL }o--|| CATEGORY : "thuộc danh mục"
    VOUCHER ||--|{ TRANSACTION : "chứa nhiều dòng"
    VOUCHER }o--o| CUSTOMER : "thuộc khách hàng"
    VOUCHER }o--o| PRODUCTION_ORDER : "gắn đơn may"
    VOUCHER }o--|| USER : "tạo bởi"
    PRODUCTION_ORDER ||--o{ BOM_LINE : "có định mức"
    BOM_LINE }o--|| MATERIAL : "NVL thành phần"
    PRODUCTION_ORDER }o--|| CUSTOMER : "đặt bởi"
    SUPPLIER }o--|| SUPPLIER_TYPE : "thuộc loại"
    MATERIAL ||--o| GIA_VON : "có giá vốn"
```

---

## 6. Cấu trúc Tệp Source Code (Tái dựng)

> [!NOTE]
> Cấu trúc bên dưới được **tái dựng (reconstructed)** từ phân tích JS bundle minified, KHÔNG phải source code thật. Dựa trên: tên routes, API client, component patterns, và conventions của React + Vite.

```
hoang-nhat-scm-dashboard/
├── 📄 index.html
├── 📄 vite.config.ts
├── 📄 tailwind.config.ts
├── 📄 tsconfig.json
├── 📄 package.json
│
├── 📁 public/
│   ├── logo-icon.png
│   └── favicon.ico
│
├── 📁 src/
│   ├── 📄 main.tsx                          # Entry point, mount React
│   ├── 📄 App.tsx                           # Root component, Router setup
│   │
│   ├── 📁 api/                              # API Client Layer
│   │   ├── 📄 client.ts                     # fetch wrapper (dt function)
│   │   │                                    #   - baseUrl = "/api/v1"
│   │   │                                    #   - x-api-key header
│   │   │                                    #   - x-encrypt-response header
│   │   │                                    #   - auto-refresh JWT
│   │   ├── 📄 repository.ts                 # Xe object — full API client
│   │   │   ├── materials.*                  #   GET/POST/DELETE /materials
│   │   │   ├── transactions.*               #   GET /inventory/transactions
│   │   │   ├── vouchers.*                   #   CRUD /vouchers
│   │   │   ├── customers.*                  #   CRUD /customers
│   │   │   ├── productionOrders.*           #   CRUD /production-orders
│   │   │   ├── suppliers.*                  #   CRUD /suppliers
│   │   │   ├── supplierTypes.*              #   CRUD /supplier-types
│   │   │   ├── categories.*                 #   CRUD /categories
│   │   │   ├── admin.*                      #   GET /admin/*
│   │   │   ├── giaVon.*                     #   GET/POST /gia-von/*
│   │   │   ├── taiKhoan.*                   #   PATCH /auth/doi-mat-khau
│   │   │   └── dashboard.*                  #   GET /dashboard/stats
│   │   ├── 📄 errors.ts                     # RepositoryError class (Fa)
│   │   └── 📄 upload.ts                     # POST /upload/image → Cloudinary
│   │
│   ├── 📁 auth/                             # Authentication
│   │   ├── 📄 AuthProvider.tsx              # Context + useAuth hook
│   │   │                                    #   - login(username, password)
│   │   │                                    #   - loginWithBadge(badgeId, pin)
│   │   │                                    #   - logout()
│   │   │                                    #   - auto-refresh token
│   │   ├── 📄 constants.ts                  # hn_auth_user, hn_access_token, etc.
│   │   └── 📄 storage.ts                    # localStorage / sessionStorage helpers
│   │
│   ├── 📁 pages/                            # Route Pages
│   │   ├── 📁 login/
│   │   │   └── 📄 LoginPage.tsx             # /login — form + badge scanner
│   │   │
│   │   ├── 📁 dashboard/
│   │   │   └── 📄 DashboardPage.tsx         # / — KPI, trends, categories breakdown
│   │   │
│   │   ├── 📁 kho/
│   │   │   ├── 📄 KhoPage.tsx              # /kho — bảng tồn kho, filter stockStatus
│   │   │   └── 📄 KiemKePage.tsx           # /kho/kiem-ke — form kiểm kê
│   │   │
│   │   ├── 📁 danh-muc-nvl/
│   │   │   └── 📄 DanhMucNvlPage.tsx       # /danh-muc-nvl — CRUD NVL, import bulk
│   │   │
│   │   ├── 📁 nhap-kho/
│   │   │   └── 📄 NhapKhoPage.tsx          # /nhap-kho — tạo/xem phiếu nhập
│   │   │
│   │   ├── 📁 xuat-kho/
│   │   │   └── 📄 XuatKhoPage.tsx          # /xuat-kho — tạo/xem phiếu xuất
│   │   │
│   │   ├── 📁 so-kho/
│   │   │   └── 📄 SoKhoPage.tsx            # /so-kho — sổ kho, xuất Excel
│   │   │
│   │   ├── 📁 don-may/
│   │   │   ├── 📄 DonMayListPage.tsx       # /don-may — danh sách đơn
│   │   │   └── 📄 DonMayDetailPage.tsx     # /don-may/:id — BOM, định mức, hao hụt
│   │   │
│   │   ├── 📁 nha-cung-cap/
│   │   │   └── 📄 NhaCungCapPage.tsx       # /nha-cung-cap — CRUD NCC + loại
│   │   │
│   │   ├── 📁 khach-hang/
│   │   │   └── 📄 KhachHangPage.tsx        # /khach-hang — CRUD khách hàng
│   │   │
│   │   └── 📁 cai-dat/
│   │       └── 📄 CaiDatPage.tsx           # /cai-dat — users, badge, giá vốn
│   │
│   ├── 📁 components/                       # Shared UI Components
│   │   ├── 📄 Layout.tsx                    # layout-dashboard — sidebar + header
│   │   ├── 📄 Sidebar.tsx                   # Navigation menu
│   │   ├── 📄 DataTable.tsx                 # Bảng dữ liệu chung
│   │   ├── 📄 FormDialog.tsx                # Dialog form (react-hook-form)
│   │   ├── 📄 ImageUploader.tsx             # Upload ảnh Cloudinary
│   │   ├── 📄 ExcelExporter.tsx             # Xuất BaoCao_Kho_HoangNhat_*.xlsx
│   │   ├── 📄 QrScanner.tsx                # Quét QR thẻ nhân viên
│   │   ├── 📄 StockStatusBadge.tsx          # Badge: ok/warn/danger
│   │   └── 📄 ProtectedRoute.tsx            # Auth guard + permission check
│   │
│   ├── 📁 hooks/                            # Custom Hooks
│   │   ├── 📄 useAuth.ts                    # Auth context consumer
│   │   ├── 📄 useMaterials.ts               # useQuery → materials
│   │   ├── 📄 useSuppliers.ts               # useQuery → suppliers
│   │   ├── 📄 useVouchers.ts                # useQuery → vouchers
│   │   ├── 📄 useTransactions.ts            # useQuery → transactions
│   │   ├── 📄 useProductionOrders.ts        # useQuery → production-orders
│   │   └── 📄 useDashboardStats.ts          # useQuery → dashboard/stats
│   │
│   ├── 📁 utils/                            # Utilities
│   │   ├── 📄 excel.ts                      # SheetJS helpers (gne function)
│   │   ├── 📄 format.ts                     # Số, ngày, tiền tệ
│   │   ├── 📄 permissions.ts                # canViewSupplier, hasPermission
│   │   └── 📄 validators.ts                 # Regex: /^\d{4,6}$/ etc.
│   │
│   └── 📁 types/                            # TypeScript Types
│       ├── 📄 material.ts
│       ├── 📄 supplier.ts
│       ├── 📄 voucher.ts
│       ├── 📄 transaction.ts
│       ├── 📄 production-order.ts
│       ├── 📄 customer.ts
│       ├── 📄 user.ts
│       └── 📄 dashboard.ts
│
└── 📁 server/                               # Backend (suy luận)
    ├── 📄 index.ts                          # Express/Fastify server
    ├── 📁 middleware/
    │   ├── 📄 auth.middleware.ts             # JWT verify + x-api-key check
    │   └── 📄 encrypt.middleware.ts          # AES encrypt response (CryptoJS)
    ├── 📁 routes/
    │   ├── 📄 auth.routes.ts                # /auth/*
    │   ├── 📄 materials.routes.ts           # /materials/*
    │   ├── 📄 inventory.routes.ts           # /inventory/*
    │   ├── 📄 vouchers.routes.ts            # /vouchers/*
    │   ├── 📄 production-orders.routes.ts   # /production-orders/*
    │   ├── 📄 suppliers.routes.ts           # /suppliers/*
    │   ├── 📄 categories.routes.ts          # /categories/*
    │   ├── 📄 customers.routes.ts           # /customers/*
    │   ├── 📄 admin.routes.ts               # /admin/*
    │   ├── 📄 gia-von.routes.ts             # /gia-von/*
    │   ├── 📄 dashboard.routes.ts           # /dashboard/*
    │   └── 📄 upload.routes.ts              # /upload/* → Cloudinary
    └── 📁 services/
        ├── 📄 auth.service.ts
        ├── 📄 material.service.ts
        ├── 📄 inventory.service.ts
        ├── 📄 voucher.service.ts
        ├── 📄 gia-von.service.ts            # Tính giá vốn trung bình
        └── 📄 cloudinary.service.ts
```

---

## 7. Luồng Request/Response

```mermaid
sequenceDiagram
    participant UI as React Component
    participant RQ as React Query
    participant Repo as API Client (Xe)
    participant Fetch as fetch()
    participant API as Backend /api/v1
    participant DB as Database

    UI->>RQ: useQuery("materials")
    RQ->>Repo: Xe.materials.danhMuc()
    Repo->>Fetch: fetch("/api/v1/materials?limit=1000")<br/>Headers: Authorization, x-api-key, x-encrypt-response

    alt Token hết hạn
        Fetch-->>Repo: 401 Unauthorized
        Repo->>Fetch: POST /auth/refresh-token
        Fetch-->>Repo: { newAccessToken }
        Repo->>Fetch: Retry original request
    end

    Fetch->>API: GET /materials?limit=1000
    API->>DB: SELECT * FROM materials
    DB-->>API: rows[]

    alt x-encrypt-response = "true"
        API-->>Fetch: { isEncrypted: true, payload: "U2FsdGVk..." }
        Fetch-->>Repo: AES decrypt → JSON
    else x-encrypt-response = "false"
        API-->>Fetch: { success: true, data: [...], meta: {...} }
    end

    Repo-->>RQ: { items, giaVonTheoLo, totalStockValue }
    RQ-->>UI: { data, isLoading, error }
    UI->>UI: Render bảng NVL
```

---

## 8. Tổng hợp Chức năng theo Quyền (RBAC)

```mermaid
flowchart TD
    subgraph Admin["👑 admin (Full Access)"]
        A1["Quản lý Users"]
        A2["Cấp/thu hồi Badge PIN"]
        A3["Reset mật khẩu"]
        A4["Cấu hình RBAC"]
        A5["Xem Audit Logs"]
        A6["Cấu hình hệ thống"]
    end

    subgraph Closing["📅 closing"]
        CL1["Xem chốt kỳ"]
        CL2["Thực hiện chốt"]
        CL3["Mở lại kỳ"]
    end

    subgraph Materials["📦 materials"]
        M1["Xem danh mục NVL"]
        M2["Xem giá NVL"]
        M3["Tạo NVL mới"]
        M4["Import hàng loạt"]
        M5["Cập nhật NVL"]
        M6["Điều chỉnh tồn kho"]
    end

    subgraph Inventory["📊 inventory"]
        I1["Xem sổ kho"]
        I2["Tạo phiếu nhập"]
        I3["Tạo phiếu xuất"]
        I4["Hủy giao dịch"]
    end

    subgraph Orders["🧵 orders"]
        O1["Xem đơn may"]
        O2["Tạo/sửa đơn"]
        O3["Xuất BOM"]
        O4["Đóng đơn"]
    end

    subgraph Suppliers["🏭 suppliers"]
        S1["Xem NCC"]
        S2["Quản lý NCC"]
        S3["Đánh giá NCC"]
    end
```
