# ==============================================================================
# Static Site 모듈 변수
# ==============================================================================

variable "project_name" {
  description = "프로젝트 이름"
  type        = string
}

variable "environment" {
  description = "배포 환경"
  type        = string
}

variable "root_domain" {
  description = "루트 도메인 (Route 53 zone name)"
  type        = string
}

variable "dashboard_domain" {
  description = "사이트 접속 도메인"
  type        = string
}

variable "bucket_name_prefix" {
  description = "S3 버킷 이름 접두사"
  type        = string
}

variable "bucket_suffix" {
  description = "S3 버킷 고유 접미사 (이관용)"
  type        = string
}

# --- API Proxy Lambda 관련 변수 ---

variable "github_token" {
  description = "GitHub Personal Access Token (SSM SecureString에 저장)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "sonarqube_token" {
  description = "SonarQube 인증 토큰 (SSM SecureString에 저장)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "sonarqube_url" {
  description = "SonarQube 서버 URL (SSM SecureString에 저장)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "api_endpoints" {
  description = "API Health 체크 대상 엔드포인트 JSON 배열 (SSM String에 저장, UI에서 동적 관리)"
  type        = string
  default     = "[]"
}

variable "github_repos" {
  description = "초기 레포지토리 목록 JSON 배열"
  type        = string
  default     = "[]"
}

variable "sonarqube_projects" {
  description = "JSON array string of SonarQube projects to monitor"
  type        = string
  default     = "[]"
}

variable "argocd_url" {
  description = "ArgoCD 서버 URL (SSM SecureString에 저장)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "argocd_token" {
  description = "ArgoCD API 토큰 (SSM SecureString에 저장)"
  type        = string
  sensitive   = true
  default     = ""
}



variable "github_oidc_provider_arn" {
  description = "GitHub Actions OIDC 연동을 위한 OpenID Connect Provider ARN"
  type        = string
}

# --- AWS 리소스 모니터링 전용 원격 S3 상태 파일 변수 ---

variable "aws_resources_s3_bucket" {
  description = "리소스 모니터링 대상 원격 tfstate가 저장된 S3 버킷명"
  type        = string
  default     = "your-terraform-state-bucket"
}

variable "aws_resources_s3_key" {
  description = "S3 버킷 내의 tfstate 파일 경로 Key"
  type        = string
  default     = "infrastructure/terraform.tfstate"
}

variable "aws_resources_region" {
  description = "리소스 모니터링 대상 S3 버킷 리전"
  type        = string
  default     = "ap-northeast-2"
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

