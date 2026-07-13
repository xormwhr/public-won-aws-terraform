# ==============================================================================
# 파일명: lambda.tf
# 경로: modules/won-homepage/lambda.tf
# 설명: API 프록시 Lambda 함수 구성 및 SSM Parameter Store 자원 정의
# ==============================================================================

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# ------------------------------------------------------------------------------
# 1. AWS SSM Parameter Store 매개변수 선언 (5종 보안 및 설정 관리)
# ------------------------------------------------------------------------------
# 최초 한 번만 지정 값으로 들어가며, 이후 수동 갱신 사항 유지를 위해 lifecycle.ignore_changes 설정 추가
resource "aws_ssm_parameter" "github_token" {
  name  = "/won-homepage/github-token"
  type  = "SecureString"
  value = var.github_token

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "github_owner" {
  name  = "/won-homepage/github-owner"
  type  = "String"
  value = var.github_owner

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "sonarqube_token" {
  name  = "/won-homepage/sonarqube-token"
  type  = "SecureString"
  value = var.sonarqube_token

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "sonarqube_url" {
  name  = "/won-homepage/sonarqube-url"
  type  = "SecureString"
  value = var.sonarqube_url

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "sonarqube_projects" {
  name  = "/won-homepage/sonarqube-projects"
  type  = "String"
  value = var.sonarqube_projects

  lifecycle { ignore_changes = [value] }
}

# 홈페이지 API 헬스 체크 대상 JSON 설정 파라미터
resource "aws_ssm_parameter" "api_endpoints" {
  name  = "/won-homepage/api-endpoints"
  type  = "String"
  value = var.api_endpoints

  lifecycle { ignore_changes = [value] }
}

# 홈페이지 모니터링 대상 GitHub 리포지토리 목록 JSON 설정 파라미터
resource "aws_ssm_parameter" "github_repos" {
  name  = "/won-homepage/github-repos"
  type  = "String"
  value = var.github_repos

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "argocd_url" {
  name  = "/won-homepage/argocd-url"
  type  = "SecureString"
  value = var.argocd_url

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "argocd_token" {
  name  = "/won-homepage/argocd-token"
  type  = "SecureString"
  value = var.argocd_token

  lifecycle { ignore_changes = [value] }
}

# ------------------------------------------------------------------------------
# 1-1. AWS 리소스 모니터링 연동 설정 파라미터 (5종)
# ------------------------------------------------------------------------------
resource "aws_ssm_parameter" "aws_resources_access_key_id" {
  name  = "/won-homepage/aws-resources-access-key-id"
  type  = "SecureString"
  value = var.aws_resources_access_key_id

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "aws_resources_secret_access_key" {
  name  = "/won-homepage/aws-resources-secret-access-key"
  type  = "SecureString"
  value = var.aws_resources_secret_access_key

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "aws_resources_s3_bucket" {
  name  = "/won-homepage/aws-resources-s3-bucket"
  type  = "String"
  value = var.aws_resources_s3_bucket

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "aws_resources_s3_key" {
  name  = "/won-homepage/aws-resources-s3-key"
  type  = "String"
  value = var.aws_resources_s3_key

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "aws_resources_region" {
  name  = "/won-homepage/aws-resources-region"
  type  = "String"
  value = var.aws_resources_region

  lifecycle { ignore_changes = [value] }
}

# ------------------------------------------------------------------------------
# 2. Lambda 소스 코드 폴더 패키징 아카이브
# ------------------------------------------------------------------------------
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/lambda.zip"
}

# ------------------------------------------------------------------------------
# 3. IAM 역할 및 정책 바인딩 (최소 권한 원칙 준수)
# ------------------------------------------------------------------------------
resource "aws_iam_role" "lambda_role" {
  name = "${var.project_name}-homepage-proxy-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

# Lambda 실행을 위한 로그 작성 권한 및 SSM Parameter 읽기 전용 IAM 정책 추가
resource "aws_iam_role_policy" "lambda_policy" {
  name = "homepage-proxy-policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        # .name 대신 deprecated되지 않은 .region 속성을 사용하여 리전 정보 주입
        Resource = "arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:*"
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParametersByPath", "ssm:PutParameter"]
        # .name 대신 deprecated되지 않은 .region 속성을 사용하여 SSM 파라미터 ARN 구성
        Resource = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter/won-homepage/*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "*"
        Condition = {
          StringEquals = { "kms:ViaService" = "ssm.${data.aws_region.current.region}.amazonaws.com" }
        }
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        # 한글 설명 주석: project_name 변수를 활용하여 버킷명 유연화
        Resource = "arn:aws:s3:::${var.project_name}-cost-cache-${var.environment}/aws-cost-cache.json"
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# 4. Lambda Function 정의 (Node.js 20.x, Single-purpose ESM)
# ------------------------------------------------------------------------------
resource "aws_lambda_function" "api_proxy" {
  function_name    = "${var.project_name}-homepage-proxy-${var.environment}"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  memory_size      = 256
  timeout          = 30
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      SSM_PREFIX     = "/won-homepage/"
      # 한글 설명 주석: project_name 변수를 활용하여 버킷명 유연화
      S3_BUCKET_NAME = "${var.project_name}-cost-cache-${var.environment}"
    }
  }
}

# ------------------------------------------------------------------------------
# 5. Lambda Function URL (CORS 통신 및 퍼블릭 액세스를 위한 인증 없음 연동)
# ------------------------------------------------------------------------------
resource "aws_lambda_function_url" "api_proxy_url" {
  function_name      = aws_lambda_function.api_proxy.function_name
  authorization_type = "NONE"
}

# Function URL에 공용 접근 권한 바인딩
resource "aws_lambda_permission" "function_url_public" {
  statement_id           = "FunctionURLAllowPublicAccess"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.api_proxy.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

# Block Public Access 예외 우회를 위한 일반 함수 직접 기동(Invoke) 권한 부여
resource "aws_lambda_permission" "function_invoke_public" {
  statement_id  = "AllowPublicInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_proxy.function_name
  principal     = "*"
}
