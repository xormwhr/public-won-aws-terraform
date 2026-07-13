# ==============================================================================
# Dashboard API Proxy Lambda 리소스
# ==============================================================================

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# --- SSM Parameter Store ---
resource "aws_ssm_parameter" "github_token" {
  name  = "/won-dashboard/github-token"
  type  = "SecureString"
  value = var.github_token

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "sonarqube_token" {
  name  = "/won-dashboard/sonarqube-token"
  type  = "SecureString"
  value = var.sonarqube_token

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "sonarqube_url" {
  name  = "/won-dashboard/sonarqube-url"
  type  = "SecureString"
  value = var.sonarqube_url

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "api_endpoints" {
  name = "/won-dashboard/api-endpoints"
  # String 타입으로 변경: Lambda에서 PutParameter로 동적 업데이트 가능
  # (github-repos와 동일한 패턴, UI에서 엔드포인트 추가/삭제)
  type  = "String"
  value = var.api_endpoints

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "github_repos" {
  name  = "/won-dashboard/github-repos"
  type  = "String"
  value = var.github_repos

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "sonarqube_projects" {
  name  = "/won-dashboard/sonarqube-projects"
  type  = "String"
  value = var.sonarqube_projects

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "argocd_url" {
  name  = "/won-dashboard/argocd-url"
  type  = "SecureString"
  value = var.argocd_url

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "argocd_token" {
  name  = "/won-dashboard/argocd-token"
  type  = "SecureString"
  value = var.argocd_token

  lifecycle { ignore_changes = [value] }
}


# --- Lambda 배포 패키지 ---
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/lambda.zip"
}

# --- IAM Role ---
resource "aws_iam_role" "lambda_role" {
  name = "${var.project_name}-dashboard-proxy-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "lambda_policy" {
  name = "dashboard-proxy-policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:*"
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParametersByPath", "ssm:PutParameter"]
        Resource = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter/won-dashboard/*"
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
        Action   = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem"
        ]
        Resource = aws_dynamodb_table.bookmarks.arn
      },
      {
        Effect   = "Allow",
        Action   = ["s3:GetObject", "s3:ListBucket"],
        Resource = [
          "arn:aws:s3:::${var.aws_resources_s3_bucket}",
          "arn:aws:s3:::${var.aws_resources_s3_bucket}/*"
        ]
      },
      {
        Effect   = "Allow",
        Action   = ["s3:GetObject"],
        Resource = "${aws_s3_bucket.cost_cache.arn}/aws-cost-cache.json"
      }
    ]
  })
}

# --- Lambda Function ---
resource "aws_lambda_function" "api_proxy" {
  function_name    = "${var.project_name}-dashboard-proxy-${var.environment}"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  memory_size      = 256
  timeout          = 30
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      SSM_PREFIX               = "/won-dashboard/"
      DYNAMODB_BOOKMARKS_TABLE = aws_dynamodb_table.bookmarks.name
      S3_BUCKET_NAME           = aws_s3_bucket.cost_cache.id
    }
  }
}

# --- Lambda Function URL ---
resource "aws_lambda_function_url" "api_proxy_url" {
  function_name      = aws_lambda_function.api_proxy.function_name
  authorization_type = "NONE"
}

# authorization_type = "NONE"이어도 리소스 기반 정책이 필요함
# 이 권한이 없으면 Function URL이 403 Forbidden을 반환
resource "aws_lambda_permission" "function_url_public" {
  statement_id           = "FunctionURLAllowPublicAccess"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.api_proxy.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

# 일부 AWS 계정에서는 lambda:InvokeFunctionUrl만으로는 부족하며
# lambda:InvokeFunction 권한도 함께 필요함 (Block Public Access 정책 관련)
resource "aws_lambda_permission" "function_invoke_public" {
  statement_id  = "AllowPublicInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_proxy.function_name
  principal     = "*"
}

# ------------------------------------------------------------------------------
# 6. 배치 Lambda용 IAM 역할 및 실행 정책 정의
# ------------------------------------------------------------------------------
resource "aws_iam_role" "collector_role" {
  name = "${var.project_name}-cost-collector-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "collector_policy" {
  name = "cost-collector-policy"
  role = aws_iam_role.collector_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:*"
      },
      {
        Effect   = "Allow"
        Action   = ["ce:GetCostAndUsage"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.cost_cache.arn}/aws-cost-cache.json"
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# 7. 배치 Lambda 소스 파일 패키징 및 함수 정의
# ------------------------------------------------------------------------------
data "archive_file" "collector_zip" {
  type        = "zip"
  source_file = "${path.module}/lambda/collector.mjs"
  output_path = "${path.module}/collector.zip"
}

resource "aws_lambda_function" "cost_collector" {
  function_name    = "${var.project_name}-cost-collector-${var.environment}"
  role             = aws_iam_role.collector_role.arn
  handler          = "collector.handler"
  runtime          = "nodejs20.x"
  memory_size      = 256
  timeout          = 60
  filename         = data.archive_file.collector_zip.output_path
  source_code_hash = data.archive_file.collector_zip.output_base64sha256

  environment {
    variables = {
      S3_BUCKET_NAME  = aws_s3_bucket.cost_cache.id
      AWS_COST_REGION = "us-east-1"
    }
  }
}

# ------------------------------------------------------------------------------
# 8. EventBridge Scheduler 트리거 정의 (매일 KST 오전 5시 실행)
# ------------------------------------------------------------------------------
resource "aws_iam_role" "scheduler_role" {
  name = "${var.project_name}-cost-scheduler-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "scheduler_policy" {
  name = "cost-scheduler-policy"
  role = aws_iam_role.scheduler_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.cost_collector.arn
    }]
  })
}

resource "aws_scheduler_schedule" "cost_collector_schedule" {
  name       = "${var.project_name}-cost-collector-schedule-${var.environment}"
  group_name = "default"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression = "cron(0 20 * * ? *)" # UTC 20:00 (한국 시간 오전 05:00)

  target {
    arn      = aws_lambda_function.cost_collector.arn
    role_arn = aws_iam_role.scheduler_role.arn
  }
}

