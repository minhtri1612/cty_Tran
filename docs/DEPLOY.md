# Triển khai trên AWS EC2

Tài liệu cho một máy EC2 nhỏ chạy Docker Compose (app + Caddy), SQLite trên ổ EBS và backup lên S3.

> **Trạng thái kiểm chứng.** Các lệnh Docker, migrate, `deploy/backup.sh` và `deploy/restore.sh` đã được chạy thử trên máy local (Linux amd64, Docker 29, Compose v5) với `aws` giả lập bằng thư mục local. **Chưa chạy thử** các phần sau: mọi lệnh `aws …` thật, quyền IAM, chứng chỉ Let's Encrypt cho tên miền thật, build trên arm64 (Graviton), và bước tạo máy EC2. Chưa tạo tài nguyên AWS nào. Kiểm tra từng bước khi làm lần đầu.

## 1. Kiến trúc

```
Internet ──443/80──> [EC2 t4g.small, Ubuntu 24.04 arm64]
                        ├─ caddy (HTTPS, Let's Encrypt)  ── mạng Docker nội bộ ──> app:4173
                        ├─ app (Node 22, user uid 1000, root FS chỉ đọc)
                        │     └─ /data  ⇐ bind mount ⇐ /srv/hoang-nhat/data  (ổ EBS riêng)
                        └─ systemd timer mỗi giờ: deploy/backup.sh ──> S3 (instance role)
Quản trị: AWS Systems Manager Session Manager (không mở SSH)
```

Bố trí thư mục trên máy:

| Đường dẫn | Nội dung | Quyền |
|---|---|---|
| `/srv/hoang-nhat/app` | mã nguồn (git checkout) + `.env` cho compose | root |
| `/srv/hoang-nhat/data` | ổ EBS riêng: `hoang-nhat.sqlite3`, `backups/` | `1000:1000`, `750` |
| `/srv/hoang-nhat/app.env` | `SETUP_TOKEN` | root, `600` |
| `/srv/hoang-nhat/backup.env` | tên bucket S3 cho timer backup | root, `600` |

## 2. Chọn máy

- **Instance:** `t4g.small` (2 vCPU Graviton, 2 GB RAM). Ứng dụng khi chạy dùng ít RAM, nhưng `docker build` (npm ci + tsc) cần bộ nhớ; `t4g.micro` (1 GB) có thể dùng nếu thêm swap 2 GB hoặc build image ở nơi khác.
- **Region:** gần Việt Nam nhất thường là `ap-southeast-1` (Singapore); kiểm tra lại độ trễ và giá.
- **Kiến trúc CPU:** image dựa trên `node:22.22.1-bookworm-slim` (đa kiến trúc). `npm ci` tự tải query engine Prisma đúng kiến trúc (`linux-arm64-openssl-3.0.x` trên Graviton). Ứng dụng không có module native nào khác. **Build image ngay trên máy EC2** (hoặc dùng `docker buildx build --platform linux/arm64`); không build trên máy amd64 rồi chép sang Graviton. Build arm64 chưa được thử.
- **AMI:** Ubuntu Server 24.04 LTS arm64 (có sẵn SSM Agent).
- **IMDSv2:** bắt buộc (`HttpTokens=required`), **hop limit = 1** để container không lấy được quyền của instance role; chỉ script backup trên host dùng quyền này.

## 3. Ổ đĩa EBS

- Ổ gốc: gp3 20 GB (hệ điều hành, Docker image, log).
- Ổ dữ liệu: gp3 10 GB riêng, gắn vào `/srv/hoang-nhat/data`. Tách ổ giúp chụp snapshot và gắn sang máy mới dễ dàng.
  ```bash
  sudo mkfs.ext4 -L hn-data /dev/nvme1n1          # CHỈ lần đầu với ổ trống — kiểm tra tên thiết bị bằng lsblk
  sudo mkdir -p /srv/hoang-nhat/data
  echo 'LABEL=hn-data /srv/hoang-nhat/data ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
  sudo mount -a && sudo chown 1000:1000 /srv/hoang-nhat/data && sudo chmod 750 /srv/hoang-nhat/data
  ```
- Bổ sung (không thay thế backup S3): Amazon Data Lifecycle Manager chụp snapshot ổ dữ liệu mỗi ngày, giữ 7 bản. Snapshot của file SQLite đang chạy chỉ ở mức crash-consistent; bản backup S3 mới là bản đúng chuẩn.

## 4. Mạng và truy cập

Security group:

| Chiều | Cổng | Nguồn | Lý do |
|---|---|---|---|
| Vào | 443/tcp, 443/udp | 0.0.0.0/0, ::/0 | HTTPS (HTTP/3) |
| Vào | 80/tcp | 0.0.0.0/0, ::/0 | Let's Encrypt HTTP-01 và chuyển hướng sang HTTPS |
| Vào | 22/tcp | **không mở** | Dùng Session Manager |
| Ra | tất cả | 0.0.0.0/0 | cập nhật gói, S3, Let's Encrypt |

- Instance role gồm: `AmazonSSMManagedInstanceCore` + quyền `s3:PutObject` vào `hourly/*`, `daily/*` và `s3:GetObject`/`s3:ListBucket` trên bucket backup. Role không có quyền xóa backup.
- Truy cập: `aws ssm start-session --target <instance-id>`. Nếu bắt buộc phải mở SSH tạm thời, chỉ mở cho IP cố định của người quản trị, có thời hạn và cần được duyệt.

## 5. Tên miền và HTTPS

1. Gắn **Elastic IP** cho instance (địa chỉ IPv4 công khai được tính phí theo giờ).
2. Tạo bản ghi DNS `A` (và `AAAA` nếu dùng IPv6) cho tên miền, ví dụ `kho.example.com`, trỏ tới Elastic IP.
3. Đợi DNS cập nhật **trước khi** khởi động Caddy; Caddy tự xin và gia hạn chứng chỉ, lưu trong volume `caddy_data`.

## 6. Cài đặt máy

```bash
# Docker Engine + Compose plugin từ kho chính thức của Docker
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
# AWS CLI v2 cho script backup
sudo snap install aws-cli --classic
```

## 7. Cài ứng dụng

```bash
sudo git clone <repo-url> /srv/hoang-nhat/app && cd /srv/hoang-nhat/app
sudo git checkout <tag-hoặc-commit-đã-duyệt>

# Biến cho docker compose
sudo tee .env >/dev/null <<'EOF'
SCM_DOMAIN=kho.example.com
SCM_DATA_DIR=/srv/hoang-nhat/data
SCM_APP_ENV=/srv/hoang-nhat/app.env
SCM_IMAGE_TAG=<commit>
EOF

# Secret: mã thiết lập quản trị viên đầu tiên
sudo install -m 600 /dev/null /srv/hoang-nhat/app.env
echo "SETUP_TOKEN=$(openssl rand -base64 24)" | sudo tee /srv/hoang-nhat/app.env >/dev/null

sudo docker compose build
sudo docker compose run --rm app node scripts/prisma.mjs migrate deploy   # tạo schema SQLite
sudo docker compose up -d
sudo docker compose ps        # app: healthy; caddy: running
curl -fsS https://kho.example.com/api/health
```

**Tạo quản trị viên đầu tiên:** mở `https://kho.example.com`, nhập tên đăng nhập, mật khẩu (≥ 12 ký tự) và mã trong `/srv/hoang-nhat/app.env` (`sudo cat`). Sau khi đã có quản trị viên, API thiết lập luôn trả lỗi `409`; có thể xóa dòng `SETUP_TOKEN` rồi chạy lại `docker compose up -d`. Tạo tài khoản riêng cho từng nhân viên trong *Cài đặt*.

Máy chủ không tự tạo hay sửa schema khi khởi động; nếu thiếu migration, container `app` dừng với thông báo hướng dẫn.

## 8. Backup lên S3

Tạo bucket (riêng tư, cùng region):

```bash
BUCKET=hoang-nhat-scm-backup-<account-id>
aws s3api create-bucket --bucket $BUCKET --region ap-southeast-1 --create-bucket-configuration LocationConstraint=ap-southeast-1
aws s3api put-public-access-block --bucket $BUCKET --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket $BUCKET --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket $BUCKET --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

Chạy các lệnh này từ máy quản trị có quyền admin, không phải từ EC2 (instance role cố ý không có quyền này).

- **Tần suất:** mỗi giờ (`hourly/`); một bản mỗi ngày lúc 02:00 giờ Việt Nam (`daily/`). Thời gian giữ bản backup cấu hình bằng S3 lifecycle rule (gợi ý: `hourly/` 14 ngày, `daily/` 365 ngày). Mất tối đa khoảng 1 giờ dữ liệu nếu mất máy.
- **Mã hóa:** SSE-S3 (AES-256); bucket chặn truy cập công khai.
- **Phương pháp:** `VACUUM INTO` bên trong container đang chạy (snapshot nhất quán dù app đang ghi) → `PRAGMA integrity_check` → gzip → sha256 → upload từ host bằng instance role. Không có AWS key trong repo, image hay container.

Cài timer:

```bash
sudo install -m 600 /dev/null /srv/hoang-nhat/backup.env
printf 'SCM_BACKUP_BUCKET=%s\nAPP_DIR=/srv/hoang-nhat/app\nSCM_DATA_DIR=/srv/hoang-nhat/data\n' "$BUCKET" | sudo tee /srv/hoang-nhat/backup.env >/dev/null
sudo cp deploy/systemd/hoang-nhat-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now hoang-nhat-backup.timer
sudo systemctl start hoang-nhat-backup.service && sudo journalctl -u hoang-nhat-backup -n 20   # chạy thử ngay
aws s3 ls s3://$BUCKET/hourly/ | tail -3
```

Theo dõi: `systemctl list-timers hoang-nhat-backup.timer`; kiểm tra định kỳ rằng bản mới nhất trên S3 không cũ hơn 2 giờ.

**Lựa chọn khác — Litestream:** sao chép liên tục WAL lên S3, mất dữ liệu chỉ vài giây, nhưng thêm một tiến trình chạy thường trực, cần cấp quyền S3 cho container và khôi phục bằng công cụ riêng. Với 3 người dùng, backup mỗi giờ đơn giản và dễ kiểm chứng hơn; chuyển sang Litestream nếu cần RPO thấp hơn.

## 9. Khôi phục

Script chỉ **kiểm tra** khi không có `--yes`; khi có `--yes` thì dừng app, **chuyển** database hiện tại vào `/srv/hoang-nhat/data/pre-restore-<thời gian>/` (không xóa), đặt bản backup vào, chạy migration (không phá dữ liệu) rồi chờ app healthy.

```bash
cd /srv/hoang-nhat/app
aws s3 ls s3://$BUCKET/hourly/ | tail -5
sudo -E deploy/restore.sh s3://$BUCKET/hourly/hoang-nhat-<UTC>.sqlite3.gz          # kiểm tra
sudo -E deploy/restore.sh s3://$BUCKET/hourly/hoang-nhat-<UTC>.sqlite3.gz --yes    # khôi phục
```

(`sudo -E` giữ biến `SCM_DATA_DIR`, `APP_DIR`; hoặc `set -a; . /srv/hoang-nhat/backup.env; set +a` trước.)

**Khôi phục trên máy EC2 mới** (mất máy cũ): làm lại mục 2–7 nhưng **bỏ qua** bước `migrate deploy` và `up -d`; tạo `/srv/hoang-nhat/data` trống (chủ sở hữu 1000), chạy `restore.sh … --yes`, rồi `docker compose up -d`. Nếu ổ EBS dữ liệu cũ còn nguyên, có thể gắn ổ đó sang máy mới thay vì khôi phục từ S3.

**Diễn tập:** mỗi tháng khôi phục bản backup mới nhất vào một thư mục/máy thử, đăng nhập và đối chiếu vài số liệu. Một bản backup chưa từng khôi phục thử thì chưa được coi là đáng tin.

## 10. Nâng cấp và rollback

```bash
cd /srv/hoang-nhat/app
sudo -E deploy/backup.sh                         # backup ngay trước khi nâng cấp
sudo git fetch && sudo git checkout <commit-mới>
sudo sed -i "s/^SCM_IMAGE_TAG=.*/SCM_IMAGE_TAG=<commit-mới>/" .env
sudo docker compose build
sudo docker compose run --rm app node scripts/prisma.mjs migrate status    # xem có migration mới không
sudo docker compose run --rm app node scripts/prisma.mjs migrate deploy
sudo docker compose up -d && sudo docker compose ps
```

Rollback:
- **Bản mới không có migration:** đặt lại `SCM_IMAGE_TAG=<commit-cũ>` trong `.env`, `git checkout <commit-cũ>`, `docker compose up -d` (image cũ vẫn còn trong Docker).
- **Bản mới đã chạy migration:** schema có thể không tương thích ngược → khôi phục bản backup tạo ngay trước khi nâng cấp (`restore.sh … --yes`) rồi chạy image cũ. Dữ liệu nhập sau thời điểm nâng cấp sẽ phải nhập lại.

## 11. Kiểm tra sức khỏe

- Docker healthcheck gọi `/api/health` (truy vấn SQLite) mỗi 30 giây; Caddy chỉ khởi động khi app healthy; cả hai `restart: unless-stopped`.
- Kiểm tra từ ngoài: `curl -fsS https://<domain>/api/health` → `{"ok":true,"database":"sqlite"}`. Có thể dùng dịch vụ uptime miễn phí hoặc Route 53 health check (có phí) để nhận cảnh báo.
- Log: `docker compose logs --since 1h app` (xoay vòng 5 × 10 MB mỗi container).

## 12. Chi phí

> **Ước tính, CHƯA kiểm chứng với bảng giá hiện tại.** Giá thay đổi theo region và thời điểm; dùng AWS Pricing Calculator cho region đã chọn trước khi quyết định.

| Thành phần | Giả định | Ước tính/tháng (USD) |
|---|---|---|
| EC2 `t4g.small` on-demand | 730 giờ, Singapore | ~12–16 |
| EBS gp3 | 20 GB gốc + 10 GB dữ liệu | ~3 |
| IPv4 công khai (Elastic IP) | 1 địa chỉ, 730 giờ | ~3.6 |
| Snapshot EBS (DLM) | 7 bản tăng dần, dữ liệu nhỏ | < 1 |
| S3 | vài trăm MB backup, ~720 PUT/tháng | < 1 |
| Truyền dữ liệu ra | vài GB/tháng | ~0 (trong hạn mức miễn phí, nếu còn) |
| **Tổng** | | **khoảng 20–25** |

Có thể giảm bằng `t4g.micro`, Savings Plan/Reserved Instance 1 năm, hoặc free tier nếu tài khoản còn đủ điều kiện.
