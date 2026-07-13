# ==============================================================================
# Outline 모듈 변수
# ==============================================================================

variable "project_name" {
  description = "프로젝트 이름"
  type        = string
}

variable "environment" {
  description = "배포 환경"
  type        = string
}

variable "aws_region" {
  description = "AWS 리전"
  type        = string
  default     = "ap-northeast-2"
}

variable "cognito_user_pool_id" {
  description = "기존 Cognito User Pool ID"
  type        = string
}

variable "outline_domain" {
  description = "Outline 접속 도메인 (예: outline.example.com)"
  type        = string
}

variable "cognito_domain_prefix" {
  description = "Cognito OAuth 2.0 도메인 접두사 (예: won-auth)"
  type        = string
  default     = "won-auth"
}

# 중앙 로그 수집용 S3 버킷 ID 변수 추가
variable "infra_log_bucket_id" {
  description = "중앙 인프라 로그 수집용 S3 버킷 ID"
  type        = string
}
