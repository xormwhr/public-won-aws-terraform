# ==============================================================================
# 변수 정의
# ==============================================================================

variable "aws_region" {
  description = "AWS 리전"
  type        = string
  default     = "ap-northeast-2"
}

variable "project_name" {
  description = "프로젝트 이름"
  type        = string
  default     = "your-project-name"
}

variable "environment" {
  description = "배포 환경 (dev, prod 등)"
  type        = string
  default     = "dev"
}

variable "root_domain" {
  description = "Route 53에서 관리하는 루트 도메인"
  type        = string
}

variable "dashboard_domain" {
  description = "대시보드 접속에 사용할 서브 도메인"
  type        = string
}

variable "bucket_name_prefix" {
  description = "S3 버킷 이름 접두사"
  type        = string
}

variable "bucket_suffix" {
  description = "기존 S3 버킷의 고유 접미사 (이관 시 일관성 유지용)"
  type        = string
}

variable "secret_domain" {
  description = "Won-Secret 접속용 서브 도메인 (예: secret.example.com)"
  type        = string
}

variable "lambda_reserved_concurrency" {
  description = "Won-Secret Lambda 예약 동시 실행 수 (기본값 10)"
  type        = number
  default     = 10
}

# --- Dashboard API Proxy 설정 ---

variable "github_token" {
  description = "GitHub Personal Access Token"
  type        = string
  sensitive   = true
  default     = ""
}

variable "sonarqube_token" {
  description = "SonarQube 인증 토큰"
  type        = string
  sensitive   = true
  default     = ""
}

variable "sonarqube_url" {
  description = "SonarQube 서버 URL"
  type        = string
  sensitive   = true
  default     = ""
}

variable "api_endpoints" {
  description = "API Health 체크 대상 엔드포인트 JSON 배열"
  type        = string
  default     = "[]"
}

variable "sonarqube_projects" {
  description = "JSON array string of SonarQube projects"
  type        = string
  default     = "[]"
}

# --- Outline 설정 ---

variable "outline_domain" {
  description = "Outline 접속 도메인"
  type        = string
  default     = "outline.example.com"
}

variable "cognito_domain_prefix" {
  description = "Cognito OAuth 2.0 도메인 접두사"
  type        = string
  default     = "won-auth"
}

# --- Won-Blog 설정 ---

variable "blog_allowed_origins" {
  description = "블로그 프론트엔드 CORS 허용 오리진 목록"
  type        = list(string)
  default     = ["http://localhost:3000"]
}

# --- Won-Homepage 설정 ---
variable "github_owner" {
  description = "GitHub Actions API를 조회할 계정명"
  type        = string
  default     = "your-github-id"
}

variable "homepage_api_endpoints" {
  description = "홈페이지 API 헬스 체크 대상 엔드포인트 목록 JSON 문자열"
  type        = string
  default     = "[]"
}

variable "homepage_github_repos" {
  description = "홈페이지 모니터링 대상 GitHub 리포지토리 목록 JSON 문자열"
  type        = string
  default     = "[]"
}

# --- Dashboard API Proxy 용 모니터링 대상 GitHub 리포지토리 목록 ---
variable "github_repos" {
  description = "대시보드 모니터링 대상 GitHub 리포지토리 목록 JSON 문자열"
  type        = string
  default     = "[]"
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



