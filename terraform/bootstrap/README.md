# bootstrap — bucket Terraform state

Chạy **một lần** cho mỗi tài khoản AWS, trước `environments/dev` và `environments/prod`.

- Tạo bucket S3 chứa state: versioning, mã hóa SSE-S3, chặn truy cập công khai, chỉ cho phép TLS, giữ phiên bản state cũ 90 ngày.
- Dùng **local state** (`terraform.tfstate` trong thư mục này) vì bucket chưa tồn tại. File này không được commit; hãy cất một bản sao an toàn (ví dụ upload thủ công vào chính bucket ở key `bootstrap/terraform.tfstate`).
- Bucket có `prevent_destroy`; `terraform destroy` sẽ bị từ chối.

```bash
cd terraform/bootstrap
cp terraform.tfvars.example terraform.tfvars   # sửa state_bucket_name
terraform init
terraform plan -out bootstrap.tfplan
terraform apply bootstrap.tfplan               # cần được duyệt — tạo tài nguyên AWS
terraform output state_bucket_name
```
