output "state_bucket_name" {
  description = "Dùng làm -backend-config=\"bucket=...\" cho environments/dev và environments/prod."
  value       = aws_s3_bucket.state.id
}

output "state_bucket_region" {
  value = var.aws_region
}
