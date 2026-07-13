# ==============================================================================
# 파일명: variables.tf
# 경로: modules/won-homepage/variables.tf
# 설명: won-homepage 호스팅 및 API Proxy 모듈에 필요한 테라폼 변수 정의
# ==============================================================================

variable "project_name" {
  description = "프로젝트의 전체 이름 (예: your-project-name)"
  type        = string
}

variable "environment" {
  description = "배포 환경 식별자 (예: main, dev, prod)"
  type        = string
}

variable "root_domain" {
  description = "Route 53 호스팅 영역이 적용된 기본 루트 도메인 (예: example.com)"
  type        = string
}

variable "bucket_name_prefix" {
  description = "정적 홈페이지 파일을 호스팅할 S3 버킷의 고유한 접두사"
  type        = string
}

variable "bucket_suffix" {
  description = "자원 고유성 식별을 위한 S3 버킷 명명용 고유 접미사"
  type        = string
}

variable "github_token" {
  description = "GitHub Actions 연동 조회용 Personal Access Token (PAT)"
  type        = string
  sensitive   = true
}

variable "github_owner" {
  description = "GitHub Actions API를 조회할 리포지토리 소유자 계정명 (예: your-github-id)"
  type        = string
}

variable "sonarqube_token" {
  description = "SonarQube 코드 지표 조회를 위한 사용자 인증 토큰"
  type        = string
  sensitive   = true
}

variable "sonarqube_url" {
  description = "SonarQube 서버 웹 서비스 엔드포인트 URL"
  type        = string
}

variable "sonarqube_projects" {
  description = "모니터링 대상 SonarQube 프로젝트 목록을 정의한 JSON 포맷의 문자열 배열"
  type        = string
}

variable "api_endpoints" {
  description = "API 헬스 체크 대상 엔드포인트 목록 JSON 문자열"
  type        = string
  default     = "[]"
}

variable "github_repos" {
  description = "모니터링 대상 GitHub 리포지토리 목록 JSON 문자열"
  type        = string
  default     = "[]"
}

variable "github_oidc_provider_arn" {
  description = "GitHub Actions OIDC 연동을 위한 OpenID Connect 공급자(Provider) ARN"
  type        = string
}

variable "argocd_url" {
  description = "ArgoCD 서버 URL"
  type        = string
  sensitive   = true
  default     = ""
}

variable "argocd_token" {
  description = "ArgoCD API 토큰"
  type        = string
  sensitive   = true
  default     = ""
}


variable "aws_resources_access_key_id" {
  description = "AWS 리소스 S3 버킷 조회를 위한 전용 IAM 사용자 Access Key ID"
  type        = string
  sensitive   = true
  default     = "dummy-access-key"
}

variable "aws_resources_secret_access_key" {
  description = "AWS 리소스 S3 버킷 조회를 위한 전용 IAM 사용자 Secret Access Key"
  type        = string
  sensitive   = true
  default     = "dummy-secret-key"
}

variable "aws_resources_s3_bucket" {
  description = "AWS 리소스 정보가 보관된 terraform.tfstate S3 버킷 이름"
  type        = string
  default     = "your-terraform-state-bucket"
}

variable "aws_resources_s3_key" {
  description = "AWS 리소스 정보가 보관된 tfstate 파일의 S3 Key 경로"
  type        = string
  default     = "infrastructure/terraform.tfstate"
}

variable "aws_resources_region" {
  description = "AWS 리소스 S3 버킷이 생성된 AWS 리전"
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


