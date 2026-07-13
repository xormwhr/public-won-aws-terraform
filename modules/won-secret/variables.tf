# ==============================================================================
# Won-Secret 모듈 입력 변수
# ==============================================================================

variable "project_name" {
  description = "프로젝트 이름"
  type        = string
}

variable "environment" {
  description = "배포 환경 (예: prod, dev)"
  type        = string
}

variable "root_domain" {
  description = "Route53 루트 도메인 (예: example.com)"
  type        = string
}

variable "secret_domain" {
  description = "Won-Secret 프론트엔드 도메인 (예: secret.example.com)"
  type        = string
}

variable "cognito_user_pool_id" {
  description = "기존 Cognito User Pool ID"
  type        = string
}

variable "cognito_user_pool_arn" {
  description = "기존 Cognito User Pool ARN"
  type        = string
}

variable "lambda_reserved_concurrency" {
  description = "Lambda 예약 동시 실행 수 (-1: 미설정/무제한, 0: 완전 제한, 양수: 명시적 제한)"
  type        = number
  default     = 10
}

variable "github_oidc_provider_arn" {
  description = "GitHub Actions OIDC 연동을 위한 OpenID Connect 공급자(Provider) ARN"
  type        = string
}

# 중앙 로그 수집용 S3 버킷 ID 변수 추가
variable "infra_log_bucket_id" {
  description = "중앙 인프라 로그 수집용 S3 버킷 ID"
  type        = string
}

# 중앙 로그 수집용 S3 버킷 도메인 네임 변수 추가 (CloudFront 로깅 설정용)
variable "infra_log_bucket_domain_name" {
  description = "중앙 인프라 로그 수집용 S3 버킷 도메인 네임 (CloudFront 로깅 설정용)"
  type        = string
}
