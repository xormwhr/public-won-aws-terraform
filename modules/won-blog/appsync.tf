# ==============================================================================
# AppSync 모듈 - GraphQL API
# ==============================================================================
#
# [AWS AppSync란?]
# - 관리형 GraphQL 서비스
# - 실시간 데이터 동기화 (Subscriptions)
# - DynamoDB, Lambda, HTTP 등 다양한 데이터 소스 연결
#
# [왜 AppSync를 사용하는가?]
# 1. VTL Resolver: Lambda 없이 DynamoDB 직접 연결 (비용 절감, 콜드스타트 없음)
# 2. GraphQL: 타입 안전성, 자동 문서화, 필요한 데이터만 요청
# 3. 듀얼 인증: API_KEY(읽기) + Cognito(쓰기) 동시 지원
# 4. 캐싱: 선택적 응답 캐싱으로 성능 향상
#
# [인증 모드 설명]
# - API_KEY: 비인증 사용자가 읽기 가능 (블로그 조회)
# - AMAZON_COGNITO_USER_POOLS: 인증된 사용자만 쓰기 가능 (글 작성)
# ==============================================================================

# ------------------------------------------------------------------------------
# AppSync GraphQL API
# ------------------------------------------------------------------------------
resource "aws_appsync_graphql_api" "main" {
  name                = "${var.project_name}-${var.environment}-api"
  authentication_type = "API_KEY" # 기본 인증 (비인증 읽기용)

  # ---------------------------------------------------------------------------
  # 추가 인증 모드 (Cognito)
  # ---------------------------------------------------------------------------
  additional_authentication_provider {
    authentication_type = "AMAZON_COGNITO_USER_POOLS"

    user_pool_config {
      user_pool_id = var.cognito_user_pool_id
      aws_region   = data.aws_region.current.region
    }
  }

  # ---------------------------------------------------------------------------
  # 스키마 정의
  # ---------------------------------------------------------------------------
  schema = file("${path.module}/schema.graphql")

  # ---------------------------------------------------------------------------
  # 로깅 설정 (CloudWatch)
  # ---------------------------------------------------------------------------
  log_config {
    cloudwatch_logs_role_arn = aws_iam_role.appsync_logs.arn
    field_log_level          = "ERROR" # ERROR만 로깅 (비용 절감)
    exclude_verbose_content  = true
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-api"
    Environment = var.environment
  }
}

# ------------------------------------------------------------------------------
# API Key (읽기 전용 접근용)
# ------------------------------------------------------------------------------
resource "aws_appsync_api_key" "main" {
  api_id  = aws_appsync_graphql_api.main.id
  expires = timeadd(timestamp(), "8760h") # 1년 후 만료

  lifecycle {
    ignore_changes = [expires] # 매번 재생성 방지
  }
}

# ------------------------------------------------------------------------------
# DynamoDB Data Source
# ------------------------------------------------------------------------------
resource "aws_appsync_datasource" "dynamodb" {
  api_id           = aws_appsync_graphql_api.main.id
  name             = "DynamoDBDataSource"
  type             = "AMAZON_DYNAMODB"
  service_role_arn = aws_iam_role.appsync_dynamodb.arn

  dynamodb_config {
    table_name = aws_dynamodb_table.main.name
    region     = data.aws_region.current.region
  }
}

# ------------------------------------------------------------------------------
# IAM Role - AppSync → DynamoDB 접근
# ------------------------------------------------------------------------------
resource "aws_iam_role" "appsync_dynamodb" {
  name = "${var.project_name}-${var.environment}-appsync-dynamodb-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "appsync.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-${var.environment}-appsync-dynamodb-role"
  }
}

resource "aws_iam_role_policy" "appsync_dynamodb" {
  name = "${var.project_name}-${var.environment}-appsync-dynamodb-policy"
  role = aws_iam_role.appsync_dynamodb.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = [
          aws_dynamodb_table.main.arn,
          "${aws_dynamodb_table.main.arn}/index/*"
        ]
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# IAM Role - AppSync → CloudWatch Logs
# ------------------------------------------------------------------------------
resource "aws_iam_role" "appsync_logs" {
  name = "${var.project_name}-${var.environment}-appsync-logs-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "appsync.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-${var.environment}-appsync-logs-role"
  }
}

resource "aws_iam_role_policy_attachment" "appsync_logs" {
  role       = aws_iam_role.appsync_logs.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppSyncPushToCloudWatchLogs"
}

# 현재 리전 조회
data "aws_region" "current" {}
