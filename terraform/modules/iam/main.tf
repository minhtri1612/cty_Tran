# Role cho EC2 (instance profile), quyền tối thiểu:
# - SSM Session Manager (quản trị, thay SSH)
# - kéo image từ đúng một ECR repository
# - ghi/đọc backup vào đúng bucket backup; KHÔNG có quyền xóa backup
data "aws_iam_policy_document" "assume_ec2" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2" {
  name               = "${var.name}-ec2"
  assume_role_policy = data.aws_iam_policy_document.assume_ec2.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_partition" "current" {}

data "aws_iam_policy_document" "app" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # API này không hỗ trợ giới hạn theo resource
  }

  statement {
    sid = "EcrPullThisRepository"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [var.ecr_repository_arn]
  }

  statement {
    sid       = "UploadBackups"
    actions   = ["s3:PutObject"]
    resources = ["${var.backup_bucket_arn}/hourly/*", "${var.backup_bucket_arn}/daily/*"]
  }

  statement {
    sid       = "ReadBackupsForRestore"
    actions   = ["s3:GetObject"]
    resources = ["${var.backup_bucket_arn}/*"]
  }

  statement {
    sid       = "ListBackupsForRestore"
    actions   = ["s3:ListBucket"]
    resources = [var.backup_bucket_arn]
  }
}

resource "aws_iam_role_policy" "app" {
  name   = "${var.name}-app"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.app.json
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.name}-ec2"
  role = aws_iam_role.ec2.name
  tags = var.tags
}
