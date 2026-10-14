output "instance_id" {
  description = "Truy cập: aws ssm start-session --target <instance_id>"
  value       = module.compute.instance_id
}

output "public_ip" {
  description = "Elastic IP — bản ghi DNS A của domain phải trỏ vào đây."
  value       = module.compute.public_ip
}

output "architecture" {
  description = "Build image: docker buildx build --platform linux/<architecture>"
  value       = module.compute.architecture
}

output "ecr_repository_url" {
  value = module.ecr.repository_url
}

output "backup_bucket_name" {
  description = "Giá trị SCM_BACKUP_BUCKET trong /srv/hoang-nhat/backup.env"
  value       = module.backup.bucket_name
}

output "data_volume_id" {
  value = module.compute.data_volume_id
}

output "domain_name" {
  value = var.domain_name
}
