locals {
  environment = "prod"
  name        = "hoang-nhat-scm-${local.environment}"
  tags = {
    Project     = "hoang-nhat-scm"
    Environment = local.environment
    ManagedBy   = "terraform"
  }
}

module "network" {
  source = "../../modules/network"

  name               = local.name
  vpc_cidr           = var.vpc_cidr
  public_subnet_cidr = var.public_subnet_cidr
  availability_zone  = var.availability_zone
}

module "security" {
  source = "../../modules/security"

  name               = local.name
  vpc_id             = module.network.vpc_id
  allowed_http_cidrs = var.allowed_http_cidrs
}

module "ecr" {
  source = "../../modules/ecr"

  repository_name    = var.ecr_repository_name
  keep_tagged_images = var.ecr_keep_tagged_images
}

module "backup" {
  source = "../../modules/backup"

  bucket_name           = var.backup_bucket_name
  hourly_retention_days = var.backup_hourly_retention_days
  daily_retention_days  = var.backup_daily_retention_days
}

module "iam" {
  source = "../../modules/iam"

  name               = local.name
  ecr_repository_arn = module.ecr.repository_arn
  backup_bucket_arn  = module.backup.bucket_arn
}

module "compute" {
  source = "../../modules/compute"

  name                   = local.name
  instance_type          = var.instance_type
  subnet_id              = module.network.public_subnet_id
  availability_zone      = module.network.availability_zone
  security_group_id      = module.security.app_security_group_id
  instance_profile_name  = module.iam.instance_profile_name
  root_volume_size_gb    = var.root_volume_size_gb
  data_volume_size_gb    = var.data_volume_size_gb
  termination_protection = var.termination_protection
  enable_ebs_snapshots   = var.enable_ebs_snapshots
  snapshot_tag_value     = local.name
}

# Tùy chọn: bản ghi DNS khi domain nằm trong Route 53. Nếu DNS ở nơi khác,
# để route53_zone_id = null và tạo bản ghi A trỏ tới output public_ip.
resource "aws_route53_record" "app" {
  count = var.route53_zone_id == null ? 0 : 1

  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "A"
  ttl     = 300
  records = [module.compute.public_ip]
}
