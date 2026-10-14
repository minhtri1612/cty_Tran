# Hoàng Nhật SCM

Ứng dụng web quản lý kho nội bộ: danh mục nguyên vật liệu và tồn kho, phiếu nhập/xuất, kiểm kê, đơn hàng may và định mức, nhà cung cấp/khách hàng, sổ kho, báo cáo Excel. Thiết kế cho một máy chủ nhỏ, khoảng 3 người dùng.

## Kiến trúc

| Thành phần | Công nghệ |
|---|---|
| Backend | Node.js 22 + TypeScript, Express 4 (`src/`) |
| Database | SQLite (một file), truy cập qua Prisma 6 (`prisma/`) |
| Frontend | HTML/CSS/JS thuần, không framework (`index.html`, `static/`) |
| Triển khai | Docker Compose: container `app` + Caddy (HTTPS), một máy EC2 |
| Backup | Snapshot SQLite mỗi giờ lên Amazon S3 (`deploy/backup.sh`) |

```
src/
  server.ts              khởi động, kiểm tra database, tắt máy an toàn (SIGTERM)
  app.ts                 Express, header bảo mật, giới hạn request, xử lý lỗi tập trung
  routes/api.ts          danh sách API
  middleware/auth.ts     đăng nhập, phân quyền, kiểm tra cùng nguồn (CSRF)
  controllers/, services/  nghiệp vụ: auth, state (toàn bộ dữ liệu kho), report (Excel)
  config/database.ts     Prisma + SQLite, đường dẫn từ SCM_DB_PATH
  __tests__/             test tự động (SQLite tạm, không cần dịch vụ ngoài)
prisma/schema.prisma, prisma/migrations/   schema và migration
scripts/prisma.mjs       chạy Prisma CLI trên đúng file SQLite (chặn lệnh phá dữ liệu)
scripts/backup.mjs       tạo / kiểm tra / giải nén bản backup SQLite
deploy/                  Caddyfile, backup/restore, systemd timer, chính sách AWS
docs/DEPLOY.md           hướng dẫn triển khai AWS EC2
docs/FUTURE-API.md       đề xuất API theo nghiệp vụ (chưa làm)
```

### Cách lưu dữ liệu

Trình duyệt tải toàn bộ dữ liệu (`GET /api/state`) và mỗi lần lưu gửi lại toàn bộ kèm số phiên bản (`PUT /api/state`). Máy chủ:

1. kiểm tra định dạng, giới hạn và tính nhất quán (tồn kho = tổng sổ kho, định mức đơn hàng, tham chiếu NCC/khách hàng…);
2. trong **một transaction**: đổi phiên bản `N → N+1` chỉ khi phiên bản đang lưu đúng bằng `N` (khóa ghi của SQLite), kiểm tra quyền của nhân viên kho trên dữ liệu hiện tại, rồi thay toàn bộ bảng;
3. lỗi ở bất kỳ bước nào → rollback toàn bộ. Hai người lưu cùng lúc từ cùng phiên bản: một người thành công, người kia nhận `409` và dữ liệu mới nhất được tải lại (không ghi đè).

Quy tắc tồn kho: mọi thay đổi tồn đều có dòng sổ kho tương ứng (nhập, xuất, kiểm kê, “Tồn ban đầu”, “Sửa hồ sơ”, nhập CSV). Máy chủ từ chối lưu nếu tồn của một mã khác tổng các dòng sổ kho của mã đó.

## Yêu cầu

- Node.js 22 (đã kiểm tra với 22.22.1) và npm
- Docker + Docker Compose v2 (cho chạy production/thử nghiệm container)

## Chạy ở máy local

```bash
npm ci                    # cài đúng phiên bản trong package-lock.json
cp .env.example .env      # tùy chọn: đổi SCM_DB_PATH
npm run db:migrate        # tạo/cập nhật schema SQLite (mặc định data/hoang-nhat.sqlite3)
npm run dev               # chạy trực tiếp TypeScript tại http://127.0.0.1:4173
```

Lần đầu mở trang sẽ hiện màn hình tạo tài khoản quản trị (mật khẩu ≥ 12 ký tự).

Bản build:

```bash
npm run build             # prisma generate + kiểm tra kiểu + biên dịch vào dist/
npm start                 # node dist/server.js
```

Máy chủ **không tự tạo database**: nếu file chưa có hoặc còn migration chưa áp dụng, nó dừng và in hướng dẫn. Đổi cổng bằng `SCM_PORT`, địa chỉ nghe bằng `SCM_HOST` (mặc định `127.0.0.1`; khi đặt `PORT` thì nghe `0.0.0.0`).

## Database và migration

- Schema nằm trong `prisma/schema.prisma`; mọi thay đổi schema phải có một thư mục trong `prisma/migrations/`.
- Áp dụng migration: `npm run db:migrate` (= `prisma migrate deploy`, chỉ chạy migration chưa áp dụng, không xóa dữ liệu). Xem trạng thái: `npm run db:status`.
- `scripts/prisma.mjs` chỉ cho phép các lệnh không phá dữ liệu. **Không dùng** `prisma db push`, `prisma migrate reset` hay `--accept-data-loss` trên database thật.
- Tạo migration mới khi sửa schema (trên máy dev):
  ```bash
  node scripts/prisma.mjs migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<YYYYMMDDHHMMSS>_<tên>/migration.sql
  ```
  Đọc kỹ SQL sinh ra (SQLite thường phải tạo lại bảng), chạy thử trên **bản sao** database thật, rồi mới commit.
- Luôn backup trước khi chạy migration trên production.

## Test

```bash
npm test                  # toàn bộ test (khoảng 1–2 phút)
npm run typecheck         # kiểm tra kiểu TypeScript
```

Mỗi file test tạo một database SQLite tạm trong thư mục tạm của hệ điều hành; khi chạy dưới `node --test`, `src/config/database.ts` từ chối mọi database nằm ngoài thư mục tạm. Test bao phủ: khởi tạo/migration, đăng nhập, phiên, phân quyền, tạo admin đầu tiên, lưu đồng thời và `409`, rollback, toàn vẹn tồn kho–sổ kho, nhập CSV, NCC/khách hàng, đơn hàng và định mức, kiểm kê, ảnh, báo cáo Excel, payload sai/quá lớn, XSS (render giao diện thật với dữ liệu độc hại), tắt máy, backup/restore. Phần giao diện được test bằng cách nạp các file `static/js` thật vào Node `vm` với DOM giả; không có test trình duyệt thật (click/form).

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `SCM_DB_PATH` | `data/hoang-nhat.sqlite3` | File SQLite (Docker: `/data/hoang-nhat.sqlite3`) |
| `NODE_ENV` | — | `production`: cookie `Secure` |
| `COOKIE_SECURE` | theo `NODE_ENV` | Ghi đè cờ `Secure` của cookie (`true`/`false`) |
| `TRUST_PROXY` | `0` | Số proxy phía trước (Docker + Caddy: `1`) để lấy IP thật khi chặn đăng nhập sai |
| `SCM_PORT` / `PORT` | `4173` | Cổng HTTP |
| `SCM_HOST` | `127.0.0.1` | Địa chỉ nghe (Docker: `0.0.0.0`) |
| `SCM_BODY_LIMIT` | `16mb` | Giới hạn request; giữ khớp với `request_body` trong `deploy/Caddyfile` |

Docker Compose còn đọc `SCM_DOMAIN`, `SCM_DATA_DIR`, `SCM_IMAGE`, `SCM_IMAGE_TAG`, `HTTP_PORT`, `HTTPS_PORT` (xem `.env.example`).

## Đăng nhập và phân quyền

- Mật khẩu băm PBKDF2-SHA256 (310.000 vòng, salt riêng); database chỉ lưu SHA-256 của token phiên.
- Cookie `HttpOnly`, `SameSite=Strict`, `Secure` khi production; phiên 12 giờ. Đổi mật khẩu hoặc xóa tài khoản sẽ hủy các phiên của tài khoản đó.
- Sai mật khẩu 10 lần trong 15 phút từ cùng IP → tạm khóa đăng nhập từ IP đó.
- Hai vai trò: **quản trị viên** (toàn quyền) và **nhân viên kho** (chỉ tạo phiếu nhập/xuất/kiểm kê mới, đổi trạng thái đơn hàng). Quyền được kiểm tra ở máy chủ, trong cùng transaction với lần lưu.

## Docker Compose

```bash
# .env cho compose (tùy chọn): SCM_DOMAIN=..., SCM_DATA_DIR=... (xem .env.example)
docker compose build
docker compose run --rm app node scripts/prisma.mjs migrate deploy   # lần đầu và sau mỗi bản cập nhật có migration
docker compose up -d
docker compose ps                        # app phải ở trạng thái healthy
```

- Không có container database; SQLite nằm trong thư mục host `SCM_DATA_DIR` (chủ sở hữu uid 1000).
- Cổng app (4173) không mở ra ngoài; chỉ Caddy mở 80/443.
- Thử local: không cần tên miền — bỏ trống `SCM_DOMAIN` thì dùng `localhost` (Caddy tự ký chứng chỉ, trình duyệt sẽ cảnh báo).
- **Không có mã thiết lập:** người đầu tiên mở trang khi database còn trống sẽ tạo được quản trị viên. Trên máy public, tạo admin ngay sau khi deploy.
- **Không chạy** `docker compose down -v` trên máy production (xóa volume chứng chỉ của Caddy).

## Production, backup và khôi phục

Xem **[docs/DEPLOY.md](docs/DEPLOY.md)**: cấu hình EC2, Caddy/HTTPS, S3, timer backup mỗi giờ, khôi phục, nâng cấp và rollback.

Tóm tắt backup:

```bash
node scripts/backup.mjs create backups/            # local: snapshot nhất quán (VACUUM INTO) + .sha256
node scripts/backup.mjs verify backups/<file>.gz   # kiểm tra checksum + PRAGMA integrity_check
deploy/restore.sh <file.gz|s3://...>               # production: chỉ kiểm tra; thêm --yes để khôi phục
```

Không bao giờ sao chép trực tiếp file `.sqlite3` khi ứng dụng đang chạy.

## Xử lý sự cố

| Triệu chứng | Cách xử lý |
|---|---|
| Máy chủ dừng ngay: “Không tìm thấy database…” / “chưa được khởi tạo…” | Chạy `npm run db:migrate` (Docker: lệnh migrate ở trên) |
| “Database còn migration chưa áp dụng” | Backup, rồi chạy migrate |
| Lưu bị báo “người khác vừa lưu” | Bình thường khi hai người lưu cùng lúc; dữ liệu đã tải lại, nhập lại thay đổi |
| “Dữ liệu gửi lên quá lớn” | Tổng dữ liệu vượt 16 MB (thường do ảnh); xóa bớt ảnh hoặc tăng `SCM_BODY_LIMIT` và Caddy |
| “Tồn kho mã … không khớp với tổng giao dịch” | Dữ liệu bị sửa ngoài ứng dụng; đối chiếu sổ kho rồi điều chỉnh bằng kiểm kê |
| Xem log | `docker compose logs -f app` / `docker compose logs -f caddy` |

## Giới hạn hiện tại và hướng mở rộng

- Toàn bộ dữ liệu được tải và gửi lại mỗi lần lưu. Ước tính (chưa đo trên dữ liệu thật): sổ kho khoảng 50 byte/dòng, nên giới hạn 16 MB đủ cho khoảng 150–200 nghìn dòng sổ kho cộng 8 MB ảnh; số dòng sổ kho tối đa là 200.000. Hướng xử lý: API theo nghiệp vụ, xem [docs/FUTURE-API.md](docs/FUTURE-API.md).
- Ảnh lưu dạng data URI trong database (tối đa ~32 KB/ảnh, tổng 8 MB). Có thể chuyển sang lưu file/S3 sau.
- Ngày lưu dạng `DD/MM/YYYY` (sắp xếp theo ngày thật ở máy chủ). Thời gian phiên và ngày tạo tài khoản là số nguyên 32-bit (giới hạn năm 2038) — cần migration sang BigInt trước thời điểm đó.
- Một tiến trình, một kết nối SQLite: phù hợp vài người dùng. Không chạy nhiều bản app trên cùng file database.
- Admin xóa phiếu sẽ xóa cả dòng sổ kho của phiếu đó (đảo ngược tồn) — đây là hành vi hiện có, không giữ lịch sử phiếu đã xóa.
- Mở rộng sau này: Litestream (backup liên tục), PostgreSQL khi cần nhiều máy chủ ứng dụng.
