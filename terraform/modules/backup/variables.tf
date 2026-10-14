variable "bucket_name" {
  description = "Tên bucket backup SQLite (duy nhất toàn cầu)."
  type        = string
}

variable "hourly_retention_days" {
  type    = number
  default = 14
}

variable "daily_retention_days" {
  type    = number
  default = 365
}

variable "tags" {
  type    = map(string)
  default = {}
}
