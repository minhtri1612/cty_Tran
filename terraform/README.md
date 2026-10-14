# Terraform — Hoàng Nhật SCM

Hạ tầng AWS chi phí thấp cho khoảng 3 người dùng: một EC2 chạy Docker (backend + Caddy), SQLite trên ổ EBS riêng, image trong ECR, backup SQLite trên S3.

```
terraform/
├── bootstrap/            bucket S3 cho Terraform state (local state)
├── environments/
│   ├── dev/              state: hoang-nhat-scm/dev/terraform.tfstate
│   └── prod/             state: hoang-nhat-scm/prod/terraform.tfstate
└── modules/
    ├── network/          VPC, public subnet, Internet Gateway, route table (không NAT)
    ├── security/         security group 80/443; không mở SSH (dùng SSM)
    ├── compute/          EC2 + ổ EBS dữ liệu mã hóa + Elastic IP + IMDSv2 (+ snapshot DLM tùy chọn)
    ├── ecr/              repository, scan on push, tag bất biến, lifecycle
    ├── iam/              role EC2: SSM, pull ECR (1 repo), ghi/đọc backup (không xóa)
    └── backup/           bucket backup SQLite: versioning, mã hóa, chặn public, lifecycle
```

Yêu cầu: Terraform ≥ 1.10, AWS provider 6.x, tài khoản AWS có quyền tạo các tài nguyên trên.

## Thứ tự triển khai

1. **Bootstrap** (một lần): xem `bootstrap/README.md` → ghi lại `state_bucket_name`.
2. **Environment:** `cd environments/<dev|prod>`, tạo `terraform.tfvars` từ file `.example`, rồi
   `terraform init -backend-config="bucket=<state_bucket_name>"`, `terraform plan`, `terraform apply`.
   Mỗi environment có state key riêng; `dev` và `prod` có VPC, EC2, ECR repository và bucket backup riêng.
3. **DNS:** trỏ bản ghi A của `domain_name` tới output `public_ip` (tự động nếu đặt `route53_zone_id`).

## Sau khi apply (thủ công, có chủ đích)

Terraform chỉ dựng máy, cài Docker và mount ổ dữ liệu vào `/srv/hoang-nhat/data`. Deploy ứng dụng:

```bash
# Máy build: image đúng kiến trúc (output "architecture"), tag = git commit (không dùng latest)
REPO=$(terraform output -raw ecr_repository_url); TAG=$(git rev-parse --short HEAD)
aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin "${REPO%%/*}"
docker buildx build --platform linux/$(terraform output -raw architecture) -t "$REPO:$TAG" --push .

# Trên EC2 (aws ssm start-session --target <instance_id>): xem docs/DEPLOY.md
#   - đặt image ECR + tag (SCM_IMAGE, SCM_IMAGE_TAG) trong /srv/hoang-nhat/app/.env
#   - docker compose pull
#   - docker compose run --rm app node scripts/prisma.mjs migrate deploy
#   - docker compose up -d
#   - SCM_BACKUP_BUCKET=<output backup_bucket_name> trong /srv/hoang-nhat/backup.env, bật timer backup
```

## Nguyên tắc an toàn

- Không secret trong Terraform. Sau khi deploy, tạo tài khoản admin ngay (không có mã thiết lập).
- Bucket state, bucket backup, ECR repository và ổ EBS dữ liệu có `prevent_destroy`; bucket/repository có `force_destroy = false`; ổ dữ liệu tạo snapshot cuối khi bị xóa.
- EC2 bỏ qua thay đổi `ami`/`user_data` để `apply` không tự thay máy; prod bật termination protection.
- IMDSv2 bắt buộc, hop limit 1: container không lấy được credential của EC2.
- Không NAT Gateway, không SSH. Quản trị bằng `aws ssm start-session`.
- Không commit `*.tfvars`, `*.tfstate`, `.terraform/`. Commit `.terraform.lock.hcl`.
- Luôn `terraform plan` và đọc kỹ trước `apply`; `plan` không được có `destroy`/`replace` cho tài nguyên dữ liệu.
