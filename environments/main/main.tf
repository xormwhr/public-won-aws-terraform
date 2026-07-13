# ==============================================================================
# Dev 환경 메인 구성
# ==============================================================================

# 1. Cognito 모듈 (사용자 인증)
module "cognito" {
  source       = "../../modules/cognito"
  project_name = var.project_name
  environment  = var.environment
}

# 2. Static Site 모듈 (Dashboard 호스팅)
module "dashboard" {
  source = "../../modules/won-dashboard"

  providers = {
    aws.useast1 = aws.useast1
  }

  project_name       = var.project_name
  environment        = var.environment
  root_domain        = var.root_domain
  dashboard_domain   = var.dashboard_domain
  bucket_name_prefix = var.bucket_name_prefix
  bucket_suffix      = var.bucket_suffix

  github_token       = var.github_token
  sonarqube_token    = var.sonarqube_token
  sonarqube_url      = var.sonarqube_url
  api_endpoints      = var.api_endpoints
  sonarqube_projects = var.sonarqube_projects
  # 대시보드 모니터링용 GitHub 리포지토리 목록 변수 주입
  github_repos       = var.github_repos
  argocd_url         = var.argocd_url
  argocd_token       = var.argocd_token

  # AWS 리소스 모니터링 연동 설정 주입
  aws_resources_s3_bucket    = var.aws_resources_s3_bucket
  aws_resources_s3_key       = var.aws_resources_s3_key
  aws_resources_region       = var.aws_resources_region

  # GitHub Actions OIDC 자격 증명 공급자 ARN 주입
  github_oidc_provider_arn   = aws_iam_openid_connect_provider.github.arn

  # 중앙 로그 수집용 S3 버킷 변수 주입 (소나큐브 Traceability 대응)
  infra_log_bucket_id          = aws_s3_bucket.infra_logs.id
  infra_log_bucket_domain_name = aws_s3_bucket.infra_logs.bucket_domain_name
}

# 3. Terraform Backend 리소스 (S3 & DynamoDB)
module "tf_backend" {
  source      = "../../modules/backend"
  environment = var.environment

  # 중앙 로그 수집용 S3 버킷 변수 주입 (소나큐브 Traceability 대응)
  infra_log_bucket_id          = aws_s3_bucket.infra_logs.id
}

# 3-1. GitHub Actions OIDC 자격 증명 공급자 (AWS 계정당 1개만 생성 필요)
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c28f7791cfc244c4fae99af93b7548842c13cb1"
  ]
}

# 4. Won-Secret 모듈 (민감정보 관리)
module "won_secret" {
  source = "../../modules/won-secret"

  providers = {
    aws.useast1 = aws.useast1
  }

  project_name                = var.project_name
  environment                 = var.environment
  root_domain                 = var.root_domain
  secret_domain               = var.secret_domain
  cognito_user_pool_id        = module.cognito.user_pool_id
  cognito_user_pool_arn       = module.cognito.user_pool_arn
  lambda_reserved_concurrency = var.lambda_reserved_concurrency
  # GitHub Actions OIDC 자격 증명 공급자 ARN 주입
  github_oidc_provider_arn    = aws_iam_openid_connect_provider.github.arn

  # 중앙 로그 수집용 S3 버킷 변수 주입 (소나큐브 Traceability 대응)
  infra_log_bucket_id          = aws_s3_bucket.infra_logs.id
  infra_log_bucket_domain_name = aws_s3_bucket.infra_logs.bucket_domain_name

  # API Gateway 글로벌 설정 완료 후 secret 모듈(Stage 등)이 생성되도록 순서 강제 (소나큐브 로깅 권한 에러 방지)
  depends_on = [
    aws_api_gateway_account.main
  ]
}

# 5. Outline 모듈 (위키/문서 관리)
module "outline" {
  source = "../../modules/outline"

  project_name          = var.project_name
  environment           = var.environment
  aws_region            = var.aws_region
  cognito_user_pool_id  = module.cognito.user_pool_id
  outline_domain        = var.outline_domain
  cognito_domain_prefix = var.cognito_domain_prefix

  # 중앙 로그 수집용 S3 버킷 변수 주입 (소나큐브 Traceability 대응)
  infra_log_bucket_id          = aws_s3_bucket.infra_logs.id
}

# ------------------------------------------------------------------------------
# 6. Won-Blog 모듈 (블로그 플랫폼)
# ------------------------------------------------------------------------------
module "won_blog" {
  source = "../../modules/won-blog"

  providers = {
    aws.useast1 = aws.useast1
  }

  project_name                = var.project_name
  environment                 = var.environment
  cognito_user_pool_id        = module.cognito.user_pool_id
  cognito_user_pool_client_id = module.cognito.user_pool_client_id
  allowed_origins             = var.blog_allowed_origins
  root_domain                 = var.root_domain
  blog_domain                 = "blog.${var.root_domain}"

  # 중앙 로그 수집용 S3 버킷 변수 주입 (소나큐브 Traceability 대응)
  infra_log_bucket_id          = aws_s3_bucket.infra_logs.id
  infra_log_bucket_domain_name = aws_s3_bucket.infra_logs.bucket_domain_name
}

# ------------------------------------------------------------------------------
# 출력값 설정 (연동용)
# ------------------------------------------------------------------------------
output "cognito_user_pool_id" {
  description = "전역 사용자 인증을 위한 Cognito User Pool ID"
  value       = module.cognito.user_pool_id
}

output "cognito_user_pool_client_id" {
  description = "대시보드 앱 연동을 위한 Cognito Client ID"
  value       = module.cognito.user_pool_client_id
}

output "dashboard_s3_bucket" {
  description = "대시보드 정적 파일이 저장된 S3 버킷 명칭"
  value       = module.dashboard.bucket_id
}

output "aws_region" {
  description = "인프라가 배포된 AWS 리전"
  value       = var.aws_region
}

output "secret_api_url" {
  description = "Won-Secret API Gateway URL (커스텀 도메인)"
  value       = module.won_secret.api_url
}

output "secret_cloudfront_distribution_id" {
  description = "Won-Secret CloudFront 배포 ID"
  value       = module.won_secret.cloudfront_distribution_id
}

output "secret_s3_bucket" {
  description = "Won-Secret 정적 파일 S3 버킷 이름"
  value       = module.won_secret.s3_bucket_name
}

output "secret_cognito_client_id" {
  description = "Won-Secret Cognito App Client ID"
  value       = module.won_secret.cognito_client_id
}

output "secret_kms_key_id" {
  description = "Won-Secret 필드 암호화 KMS 키 ID"
  value       = module.won_secret.kms_key_id
}

output "outline_s3_bucket" {
  description = "Outline 파일 업로드 S3 버킷 이름"
  value       = module.outline.s3_bucket_name
}

output "outline_iam_access_key_id" {
  description = "Outline S3 IAM Access Key ID"
  value       = module.outline.iam_access_key_id
}

output "outline_iam_secret_access_key" {
  description = "Outline S3 IAM Secret Access Key"
  value       = module.outline.iam_secret_access_key
  sensitive   = true
}

output "outline_cognito_client_id" {
  description = "Outline Cognito App Client ID"
  value       = module.outline.cognito_client_id
}

output "outline_cognito_client_secret" {
  description = "Outline Cognito App Client Secret"
  value       = module.outline.cognito_client_secret
  sensitive   = true
}

output "outline_cognito_domain" {
  description = "Cognito OAuth 2.0 도메인 URL"
  value       = module.outline.cognito_domain
}

output "blog_appsync_graphql_url" {
  description = "블로그 AppSync GraphQL 엔드포인트"
  value       = module.won_blog.appsync_graphql_url
}

output "blog_appsync_api_key" {
  description = "블로그 AppSync API Key"
  value       = module.won_blog.appsync_api_key
  sensitive   = true
}

output "blog_images_cloudfront_domain" {
  description = "블로그 이미지 CDN 도메인"
  value       = module.won_blog.images_cloudfront_domain
}

output "blog_identity_pool_id" {
  description = "블로그 S3 업로드용 Identity Pool ID"
  value       = module.won_blog.identity_pool_id
}

output "blog_hosting_s3_bucket" {
  description = "블로그 정적 파일 S3 버킷"
  value       = module.won_blog.hosting_s3_bucket
}

output "blog_hosting_cloudfront_id" {
  description = "블로그 CloudFront 배포 ID"
  value       = module.won_blog.hosting_cloudfront_id
}

output "blog_hosting_url" {
  description = "블로그 접속 URL"
  value       = module.won_blog.hosting_cloudfront_domain
}

# ------------------------------------------------------------------------------
# 7. Won-Homepage 모듈 (포트폴리오 홈페이지)
# ------------------------------------------------------------------------------
module "won_homepage" {
  source = "../../modules/won-homepage"

  providers = {
    aws.useast1 = aws.useast1
  }

  project_name       = var.project_name
  environment        = var.environment
  root_domain        = var.root_domain
  bucket_name_prefix = "won-homepage-assets"
  bucket_suffix      = var.bucket_suffix

  github_token       = var.github_token
  github_owner       = var.github_owner
  sonarqube_token    = var.sonarqube_token
  sonarqube_url      = var.sonarqube_url
  sonarqube_projects = var.sonarqube_projects

  # 홈페이지용 헬스체크 API 및 GitHub Actions 모니터링 대상 연동
  api_endpoints      = var.homepage_api_endpoints
  github_repos       = var.homepage_github_repos

  # ArgoCD 연동 정보
  argocd_url         = var.argocd_url
  argocd_token       = var.argocd_token

  # GitHub Actions OIDC 자격 증명 공급자 ARN 주입
  github_oidc_provider_arn = aws_iam_openid_connect_provider.github.arn

  # AWS 리소스 모니터링 연동 설정 주입
  aws_resources_access_key_id     = var.aws_resources_access_key_id
  aws_resources_secret_access_key = var.aws_resources_secret_access_key
  aws_resources_s3_bucket        = var.aws_resources_s3_bucket
  aws_resources_s3_key           = var.aws_resources_s3_key
  aws_resources_region           = var.aws_resources_region

  # 중앙 로그 수집용 S3 버킷 변수 주입 (소나큐브 Traceability 대응)
  infra_log_bucket_id          = aws_s3_bucket.infra_logs.id
  infra_log_bucket_domain_name = aws_s3_bucket.infra_logs.bucket_domain_name
}

# ------------------------------------------------------------------------------
# Won-Homepage 출력값 설정
# ------------------------------------------------------------------------------
output "homepage_cloudfront_domain" {
  description = "홈페이지 CloudFront 접속 도메인"
  value       = module.won_homepage.cloudfront_domain
}

output "homepage_s3_bucket" {
  description = "홈페이지 정적 자산 보관 S3 버킷"
  value       = module.won_homepage.bucket_id
}

output "homepage_github_actions_role_arn" {
  description = "홈페이지 GitHub Actions OIDC 배포를 위한 IAM 역할 ARN"
  value       = module.won_homepage.github_actions_role_arn
}

output "argocd_cognito_client_id" {
  description = "ArgoCD Cognito App Client ID"
  value       = module.cognito.argocd_cognito_client_id
}

output "argocd_cognito_client_secret" {
  description = "ArgoCD Cognito App Client Secret"
  value       = module.cognito.argocd_cognito_client_secret
  sensitive   = true
}

output "grafana_cognito_client_id" {
  description = "Grafana Cognito App Client ID"
  value       = module.cognito.grafana_cognito_client_id
}

output "grafana_cognito_client_secret" {
  description = "Grafana Cognito App Client Secret"
  value       = module.cognito.grafana_cognito_client_secret
  sensitive   = true
}

output "secret_github_actions_role_arn" {
  description = "Won-Secret GitHub Actions OIDC 배포를 위한 IAM 역할 ARN"
  value       = module.won_secret.github_actions_role_arn
}

output "dashboard_github_actions_role_arn" {
  description = "대시보드 GitHub Actions OIDC 배포를 위한 IAM 역할 ARN"
  value       = module.dashboard.github_actions_role_arn
}

# ==============================================================================
# 8. 중앙 로그 수집용 S3 버킷 (S3 액세스 로그 및 CloudFront 액세스 로그용)
# ==============================================================================
resource "aws_s3_bucket" "infra_logs" {
  bucket        = "${var.project_name}-infra-logs-${var.environment}-${var.bucket_suffix}"
  force_destroy = true # 개발/테스트용 정리 가능하도록 설정

  tags = {
    Name        = "${var.project_name}-infra-logs-${var.environment}"
    Environment = var.environment
    Purpose     = "InfraLogging"
  }
}

# 중앙 로그 S3 버킷 자체의 액세스 로깅 활성화 (소나큐브 S6252 대응)
resource "aws_s3_bucket_logging" "infra_logs" {
  # 로깅을 활성화할 대상 버킷 (자기 자신)
  bucket        = aws_s3_bucket.infra_logs.id
  # 로그 파일이 저장될 S3 버킷 ID
  target_bucket = aws_s3_bucket.infra_logs.id
  # 로그 보관 접두사
  target_prefix = "s3/infra-logs/"
}

# 퍼블릭 액세스 완전 차단
resource "aws_s3_bucket_public_access_block" "infra_logs" {
  bucket = aws_s3_bucket.infra_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 서버 측 AES256 기본 암호화 적용
resource "aws_s3_bucket_server_side_encryption_configuration" "infra_logs" {
  bucket = aws_s3_bucket.infra_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# HTTPS 통신만 허용하는 버킷 정책
resource "aws_s3_bucket_policy" "infra_logs_https_only" {
  bucket = aws_s3_bucket.infra_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnforceHTTPSOnly"
        Effect    = "Deny"
        Principal = {
          AWS = "*"
        }
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.infra_logs.arn,
          "${aws_s3_bucket.infra_logs.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}

# 객체 소유권 설정 (ACL 활성화를 위해 필요)
resource "aws_s3_bucket_ownership_controls" "infra_logs" {
  bucket = aws_s3_bucket.infra_logs.id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

# 로그 버킷 ACL 설정 (S3 Log Delivery 대상이 되기 위함)
resource "aws_s3_bucket_acl" "infra_logs_acl" {
  depends_on = [aws_s3_bucket_ownership_controls.infra_logs]
  bucket     = aws_s3_bucket.infra_logs.id
  acl        = "log-delivery-write"
}

# 8-1. S3 버킷 수명 주기(Lifecycle) 설정 (비용 최적화 및 오래된 로그 자동 정리)
resource "aws_s3_bucket_lifecycle_configuration" "infra_logs" {
  # 대상 S3 버킷 ID 지정
  bucket = aws_s3_bucket.infra_logs.id

  rule {
    id     = "infra-logs-expiration"
    status = "Enabled"

    # 30일 경과 시 객체 자동 영구 삭제 설정
    expiration {
      days = 30
    }
  }
}

# API Gateway가 CloudWatch Logs에 쓰기 작업을 수행할 수 있도록 허용하는 IAM 역할 정의
resource "aws_iam_role" "api_gateway_cloudwatch" {
  name = "${var.project_name}-api-gateway-cw-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowAPIGatewayAssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "apigateway.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

# AWS 관리형 정책(AmazonAPIGatewayPushToCloudWatchLogs)을 IAM 역할에 연결
resource "aws_iam_role_policy_attachment" "api_gateway_cloudwatch" {
  role       = aws_iam_role.api_gateway_cloudwatch.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}

# AWS 계정 수준에서 API Gateway의 CloudWatch 로깅 활성화를 위해 역할 지정
resource "aws_api_gateway_account" "main" {
  cloudwatch_role_arn = aws_iam_role.api_gateway_cloudwatch.arn
}

