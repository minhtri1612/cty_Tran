output "instance_id" {
  value = aws_instance.this.id
}

output "public_ip" {
  description = "Elastic IP — trỏ DNS của domain vào địa chỉ này."
  value       = aws_eip.this.public_ip
}

output "architecture" {
  description = "Kiến trúc CPU; build image Docker với --platform linux/<giá trị này>."
  value       = local.architecture
}

output "data_volume_id" {
  value = aws_ebs_volume.data.id
}
