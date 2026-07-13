# ==============================================================================
# Lambda 함수 및 IAM Role
# ==============================================================================

# Lambda 소스 코드 압축
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/lambda.zip"
}

# Lambda 실행용 IAM Role
resource "aws_iam_role" "lambda_role" {
  name = "${var.project_name}-secret-lambda-${var.environment}"

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

# Lambda 권한 정책 (DynamoDB, KMS, Logs)
resource "aws_iam_role_policy" "lambda_policy" {
  name = "${var.project_name}-secret-lambda-policy-${var.environment}"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem"
        ]
        Resource = [
          aws_dynamodb_table.secrets.arn,
          "${aws_dynamodb_table.secrets.arn}/index/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = [aws_kms_key.field_encryption.arn]
      },
      {
        Effect = "Allow"
        Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        # 최소 권한 원칙: 이 Lambda 함수의 로그 그룹으로 범위를 제한한다.
        Resource = [
          "arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.project_name}-secret-handler-${var.environment}",
          "arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.project_name}-secret-handler-${var.environment}:*"
        ]
      }
    ]
  })
}

# Lambda 함수 정의
resource "aws_lambda_function" "handler" {
  function_name    = "${var.project_name}-secret-handler-${var.environment}"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 15
  memory_size      = 256
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  # 계정 전체 동시 실행 한도 소진 방지: 명시적으로 예약 동시 실행 수를 제한한다.
  # API Gateway throttling(burst=50, rate=100)과 균형을 맞춰 기본값 10으로 설정한다.
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  environment {
    variables = {
      TABLE_NAME     = aws_dynamodb_table.secrets.name
      KMS_KEY_ID     = aws_kms_key.field_encryption.key_id
      ALLOWED_ORIGIN = "https://${var.secret_domain}"
    }
  }

  tags = {
    Name = "${var.project_name}-secret-handler-${var.environment}"
  }
}

# API Gateway 호출 권한 부여
resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.handler.function_name
  principal     = "apigateway.amazonaws.com"
  # API Gateway 리소스가 생성된 후 source_arn을 더 구체화할 수 있으나, 
  # 순환 참조 방지를 위해 api_gateway_rest_api.api.execution_arn 기반으로 설정한다.
  source_arn = "${aws_api_gateway_rest_api.api.execution_arn}/*/*"
}
