# environments/dev

Hạ tầng **dev**: VPC + public subnet (không NAT Gateway), security group (80/443, không SSH), EC2 Ubuntu 24.04 chạy Docker với IMDSv2, ổ EBS dữ liệu mã hóa cho SQLite, Elastic IP, ECR repository, bucket backup SQLite, IAM role tối thiểu (SSM, pull ECR, ghi backup).

State: `s3://<state bucket>/hoang-nhat-scm/dev/terraform.tfstate` (khóa bằng `use_lockfile`).

```bash
cd terraform/environments/dev
cp terraform.tfvars.example terraform.tfvars          # sửa giá trị
terraform init -backend-config="bucket=<state_bucket_name từ bootstrap>"
terraform plan -out dev.tfplan
terraform apply dev.tfplan                            # cần được duyệt — tạo tài nguyên AWS
terraform output
```

Terraform **không** deploy ứng dụng và **không** chạy migration. Sau khi apply, làm theo phần "Sau khi apply" trong `terraform/README.md`.
