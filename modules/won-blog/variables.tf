# ==============================================================================
# Won-Blog 모듈 - 입력 변수
# ==============================================================================

variable "project_name" {
  description = "프로젝트 이름"
  type        = string
}

variable "environment" {
  description = "환경 이름 (main, dev 등)"
  type        = string
}

variable "cognito_user_pool_id" {
  description = "공유 Cognito User Pool ID (AppSync 인증 + Identity Pool)"
  type        = string
}

variable "cognito_user_pool_client_id" {
  description = "공유 Cognito App Client ID (Identity Pool Provider)"
  type        = string
}

variable "allowed_origins" {
  description = "S3 이미지 CORS 허용 오리진 목록"
  type        = list(string)
  default     = ["http://localhost:3000"]
}

variable "root_domain" {
  description = "Route53 Root Domain"
  type        = string
}

variable "blog_domain" {
  description = "Blog Custom Domain"
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
