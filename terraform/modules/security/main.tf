# Security group cho EC2: chỉ mở HTTP/HTTPS cho Caddy. Không có rule SSH (22):
# quản trị bằng AWS Systems Manager Session Manager (đi ra qua HTTPS, không cần
# cổng vào).
resource "aws_security_group" "app" {
  name        = "${var.name}-app"
  description = "Caddy HTTP/HTTPS only; admin access via SSM (no SSH)"
  vpc_id      = var.vpc_id

  tags = merge(var.tags, { Name = "${var.name}-app" })
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  for_each = toset(var.allowed_http_cidrs)

  security_group_id = aws_security_group.app.id
  description       = "HTTP (Let's Encrypt HTTP-01 + redirect to HTTPS)"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = each.value
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  for_each = toset(var.allowed_http_cidrs)

  security_group_id = aws_security_group.app.id
  description       = "HTTPS"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = each.value
}

resource "aws_vpc_security_group_ingress_rule" "http3" {
  for_each = toset(var.allowed_http_cidrs)

  security_group_id = aws_security_group.app.id
  description       = "HTTP/3 (QUIC)"
  ip_protocol       = "udp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = each.value
}

# Đi ra: cập nhật gói, ECR, S3, SSM, Let's Encrypt.
resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.app.id
  description       = "All outbound"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
