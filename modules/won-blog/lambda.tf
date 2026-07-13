# ==============================================================================
# Lambda Resolver - IP 기반 방문자 통계 및 글 조회수
# ==============================================================================
#
# [왜 Lambda Resolver를 사용하는가?]
# - VTL에서는 SHA-256 해싱이 불가능
# - IP 해싱을 통한 개인정보 보호가 핵심 요구사항
# - DynamoDB 조건부 쓰기(ConditionExpression) + 카운터 증가를 하나의
#   트랜잭션으로 처리해야 하므로 Lambda가 적합
#
# [비용 분석]
# - 블로그 규모의 트래픽에서 Lambda 비용은 미미
# - 프리티어: 월 100만 요청, 40만 GB-초 무료
# ==============================================================================

# ------------------------------------------------------------------------------
# Lambda 함수 코드 패키징 (ZIP)
# ------------------------------------------------------------------------------
data "archive_file" "visitor_lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/visitor"
  output_path = "${path.module}/lambda/visitor/visitor.zip"
}

# ------------------------------------------------------------------------------
# Lambda IAM Role
# ------------------------------------------------------------------------------
resource "aws_iam_role" "visitor_lambda" {
  name = "${var.project_name}-${var.environment}-visitor-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-${var.environment}-visitor-lambda-role"
  }
}

# ------------------------------------------------------------------------------
# Lambda IAM Policy - DynamoDB 접근 + CloudWatch Logs
# ------------------------------------------------------------------------------
resource "aws_iam_role_policy" "visitor_lambda" {
  name = "${var.project_name}-${var.environment}-visitor-lambda-policy"
  role = aws_iam_role.visitor_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # CloudWatch Logs 권한
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        # DynamoDB Read/Write 권한
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:GetItem"
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
# Lambda Function
# ------------------------------------------------------------------------------
resource "aws_lambda_function" "visitor" {
  filename         = data.archive_file.visitor_lambda_zip.output_path
  function_name    = "${var.project_name}-${var.environment}-visitor-resolver"
  role             = aws_iam_role.visitor_lambda.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.visitor_lambda_zip.output_base64sha256
  runtime          = "nodejs20.x"
  timeout          = 10
  memory_size      = 128

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.main.name
    }
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-visitor-resolver"
    Environment = var.environment
  }
}

# ------------------------------------------------------------------------------
# AppSync Lambda DataSource
# ------------------------------------------------------------------------------
resource "aws_appsync_datasource" "visitor_lambda" {
  api_id           = aws_appsync_graphql_api.main.id
  name             = "VisitorLambdaDataSource"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_lambda.arn

  lambda_config {
    function_arn = aws_lambda_function.visitor.arn
  }
}

# ------------------------------------------------------------------------------
# IAM Role - AppSync → Lambda 호출 권한
# ------------------------------------------------------------------------------
resource "aws_iam_role" "appsync_lambda" {
  name = "${var.project_name}-${var.environment}-appsync-lambda-role"

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
    Name = "${var.project_name}-${var.environment}-appsync-lambda-role"
  }
}

resource "aws_iam_role_policy" "appsync_lambda" {
  name = "${var.project_name}-${var.environment}-appsync-lambda-policy"
  role = aws_iam_role.appsync_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = aws_lambda_function.visitor.arn
      }
    ]
  })
}

# ==============================================================================
# Attachment Lambda - S3 Presigned URL 생성
# ==============================================================================
#
# [역할]
# - 블로그 포스트 첨부파일의 S3 Presigned Upload URL 생성
# - 기존 s3-images 버킷의 attachments/ 프리픽스에 파일 저장
#
# [비용 분석]
# - Lambda 호출: 파일 업로드 시에만 (인증된 사용자만 호출)
# - S3 PUT: 프리티어 2,000건 무료
# ==============================================================================

# ------------------------------------------------------------------------------
# Lambda 함수 코드 패키징 (ZIP)
# ------------------------------------------------------------------------------
data "archive_file" "attachment_lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/attachment"
  output_path = "${path.module}/lambda/attachment/attachment.zip"
}

# ------------------------------------------------------------------------------
# Lambda IAM Role
# ------------------------------------------------------------------------------
resource "aws_iam_role" "attachment_lambda" {
  name = "${var.project_name}-${var.environment}-attachment-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-${var.environment}-attachment-lambda-role"
  }
}

# ------------------------------------------------------------------------------
# Lambda IAM Policy - S3 PutObject + CloudWatch Logs
# ------------------------------------------------------------------------------
resource "aws_iam_role_policy" "attachment_lambda" {
  name = "${var.project_name}-${var.environment}-attachment-lambda-policy"
  role = aws_iam_role.attachment_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # CloudWatch Logs 권한
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        # S3 PutObject 권한 (attachments/ 프리픽스만)
        Effect = "Allow"
        Action = [
          "s3:PutObject"
        ]
        Resource = "${aws_s3_bucket.images.arn}/attachments/*"
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# Lambda Function
# ------------------------------------------------------------------------------
resource "aws_lambda_function" "attachment" {
  filename         = data.archive_file.attachment_lambda_zip.output_path
  function_name    = "${var.project_name}-${var.environment}-attachment-resolver"
  role             = aws_iam_role.attachment_lambda.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.attachment_lambda_zip.output_base64sha256
  runtime          = "nodejs20.x"
  timeout          = 10
  memory_size      = 128

  environment {
    variables = {
      BUCKET_NAME = aws_s3_bucket.images.bucket
    }
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-attachment-resolver"
    Environment = var.environment
  }
}

# ------------------------------------------------------------------------------
# AppSync Lambda DataSource (Attachment)
# ------------------------------------------------------------------------------
resource "aws_appsync_datasource" "attachment_lambda" {
  api_id           = aws_appsync_graphql_api.main.id
  name             = "AttachmentLambdaDataSource"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_attachment_lambda.arn

  lambda_config {
    function_arn = aws_lambda_function.attachment.arn
  }
}

# ------------------------------------------------------------------------------
# IAM Role - AppSync → Attachment Lambda 호출 권한
# ------------------------------------------------------------------------------
resource "aws_iam_role" "appsync_attachment_lambda" {
  name = "${var.project_name}-${var.environment}-appsync-attachment-role"

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
    Name = "${var.project_name}-${var.environment}-appsync-attachment-role"
  }
}

resource "aws_iam_role_policy" "appsync_attachment_lambda" {
  name = "${var.project_name}-${var.environment}-appsync-attachment-policy"
  role = aws_iam_role.appsync_attachment_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = aws_lambda_function.attachment.arn
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# AppSync Resolver - getPresignedUploadUrl
# ------------------------------------------------------------------------------
resource "aws_appsync_resolver" "get_presigned_upload_url" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Mutation"
  field       = "getPresignedUploadUrl"
  data_source = aws_appsync_datasource.attachment_lambda.name
}

# ==============================================================================
# Post Lambda - 포스트 및 첨부파일 일괄 삭제
# ==============================================================================

# ------------------------------------------------------------------------------
# Lambda 함수 코드 패키징 (ZIP)
# ------------------------------------------------------------------------------
data "archive_file" "post_lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/post"
  output_path = "${path.module}/lambda/post/post.zip"
}

# ------------------------------------------------------------------------------
# Lambda IAM Role
# ------------------------------------------------------------------------------
resource "aws_iam_role" "post_lambda" {
  name = "${var.project_name}-${var.environment}-post-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# Lambda IAM Policy - DynamoDB + S3 Delete + CloudWatch Logs
# ------------------------------------------------------------------------------
resource "aws_iam_role_policy" "post_lambda" {
  name = "${var.project_name}-${var.environment}-post-lambda-policy"
  role = aws_iam_role.post_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:DeleteItem"
        ]
        Resource = aws_dynamodb_table.main.arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:DeleteObject",
          "s3:DeleteObjects"
        ]
        Resource = "${aws_s3_bucket.images.arn}/attachments/*"
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# Lambda Function
# ------------------------------------------------------------------------------
resource "aws_lambda_function" "post" {
  filename         = data.archive_file.post_lambda_zip.output_path
  function_name    = "${var.project_name}-${var.environment}-post-resolver"
  role             = aws_iam_role.post_lambda.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.post_lambda_zip.output_base64sha256
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 128

  environment {
    variables = {
      TABLE_NAME  = aws_dynamodb_table.main.name
      BUCKET_NAME = aws_s3_bucket.images.bucket
    }
  }
}

# ------------------------------------------------------------------------------
# AppSync Lambda DataSource (Post)
# ------------------------------------------------------------------------------
resource "aws_appsync_datasource" "post_lambda" {
  api_id           = aws_appsync_graphql_api.main.id
  name             = "PostLambdaDataSource"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_post_lambda.arn

  lambda_config {
    function_arn = aws_lambda_function.post.arn
  }
}

# ------------------------------------------------------------------------------
# IAM Role - AppSync → Post Lambda 호출 권한
# ------------------------------------------------------------------------------
resource "aws_iam_role" "appsync_post_lambda" {
  name = "${var.project_name}-${var.environment}-appsync-post-role"

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
}

resource "aws_iam_role_policy" "appsync_post_lambda" {
  name = "${var.project_name}-${var.environment}-appsync-post-policy"
  role = aws_iam_role.appsync_post_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = aws_lambda_function.post.arn
      }
    ]
  })
}
