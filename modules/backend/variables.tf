# ==============================================================================
# Backend 모듈 변수
# ==============================================================================

variable "state_bucket_name" {
  description = "S3 버킷 이름"
  type        = string
  default     = "your-terraform-state-bucket"
}

variable "lock_table_name" {
  description = "DynamoDB 테이블 이름"
  type        = string
  default     = "won-terraform-lock-main"
}

variable "environment" {
  description = "배포 환경"
  type        = string
}

# 중앙 로그 수집용 S3 버킷 ID 변수 추가
variable "infra_log_bucket_id" {
  description = "중앙 인프라 로그 수집용 S3 버킷 ID"
  type        = string
}
