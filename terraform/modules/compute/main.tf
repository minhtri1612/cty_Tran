# Một EC2 chạy Docker (app + Caddy), ổ gốc và ổ dữ liệu đều mã hóa, IMDSv2.
# SQLite nằm trên ổ EBS dữ liệu riêng gắn vào /srv/hoang-nhat/data, không nằm
# trong container. Terraform chỉ chuẩn bị máy; không deploy app, không chạy
# migration (xem docs/DEPLOY.md).

data "aws_ec2_instance_type" "this" {
  instance_type = var.instance_type
}

locals {
  # t4g.* -> arm64 (Graviton), t3.* -> amd64. Image Docker phải build cùng kiến trúc.
  architecture = contains(data.aws_ec2_instance_type.this.supported_architectures, "arm64") ? "arm64" : "amd64"
}

data "aws_ssm_parameter" "ubuntu_ami" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/${local.architecture}/hvm/ebs-gp3/ami-id"
}

resource "aws_ebs_volume" "data" {
  availability_zone = var.availability_zone
  size              = var.data_volume_size_gb
  type              = "gp3"
  encrypted         = true
  final_snapshot    = true

  tags = merge(var.tags, {
    Name     = "${var.name}-data"
    Snapshot = var.snapshot_tag_value
  })

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_instance" "this" {
  ami                     = data.aws_ssm_parameter.ubuntu_ami.value
  instance_type           = var.instance_type
  subnet_id               = var.subnet_id
  vpc_security_group_ids  = [var.security_group_id]
  iam_instance_profile    = var.instance_profile_name
  disable_api_termination = var.termination_protection
  monitoring              = false

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # IMDSv2
    http_put_response_hop_limit = 1          # container không lấy được credential của instance
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size_gb
    encrypted             = true
    delete_on_termination = true
  }

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    data_volume_id = aws_ebs_volume.data.id
  })

  tags = merge(var.tags, { Name = var.name })

  lifecycle {
    # AMI mới hoặc sửa user_data không được tự thay máy (dữ liệu nằm trên ổ riêng,
    # nhưng thay máy vẫn gây gián đoạn). Đổi máy là việc có chủ đích.
    ignore_changes = [ami, user_data]
  }
}

resource "aws_volume_attachment" "data" {
  device_name                    = "/dev/sdf"
  volume_id                      = aws_ebs_volume.data.id
  instance_id                    = aws_instance.this.id
  stop_instance_before_detaching = true
}

resource "aws_eip" "this" {
  domain   = "vpc"
  instance = aws_instance.this.id

  tags = merge(var.tags, { Name = "${var.name}-eip" })
}

# Snapshot hằng ngày của ổ dữ liệu (bổ sung, không thay backup S3).
data "aws_iam_policy_document" "dlm_assume" {
  count = var.enable_ebs_snapshots ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["dlm.amazonaws.com"]
    }
  }
}

data "aws_partition" "current" {}

resource "aws_iam_role" "dlm" {
  count = var.enable_ebs_snapshots ? 1 : 0

  name               = "${var.name}-dlm"
  assume_role_policy = data.aws_iam_policy_document.dlm_assume[0].json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "dlm" {
  count = var.enable_ebs_snapshots ? 1 : 0

  role       = aws_iam_role.dlm[0].name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "data" {
  count = var.enable_ebs_snapshots ? 1 : 0

  description        = "${var.name} daily data volume snapshots"
  execution_role_arn = aws_iam_role.dlm[0].arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = { Snapshot = var.snapshot_tag_value }

    schedule {
      name = "daily"
      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["19:00"] # UTC = 02:00 giờ Việt Nam
      }
      retain_rule {
        count = var.snapshot_retain_count
      }
      copy_tags = true
    }
  }

  tags = var.tags
}
