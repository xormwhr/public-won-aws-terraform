# ==============================================================================
# API Gateway REST API 정의
# ==============================================================================

resource "aws_api_gateway_rest_api" "api" {
  name        = "${var.project_name}-secret-api-${var.environment}"
  description = "Won-Secret 민감정보 관리 API"
  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

# Cognito Authorizer 설정
resource "aws_api_gateway_authorizer" "cognito" {
  name            = "CognitoAuthorizer"
  rest_api_id     = aws_api_gateway_rest_api.api.id
  type            = "COGNITO_USER_POOLS"
  provider_arns   = [var.cognito_user_pool_arn]
  identity_source = "method.request.header.Authorization"
}

# Regional ACM 인증서 (API용)
resource "aws_acm_certificate" "api" {
  domain_name       = "api.${var.secret_domain}"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${var.project_name}-secret-api-cert-${var.environment}"
  }
}

resource "aws_route53_record" "api_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.selected.zone_id
}

resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for record in aws_route53_record.api_cert_validation : record.fqdn]
}

# ------------------------------------------------------------------------------
# 리소스 경로 정의
# ------------------------------------------------------------------------------

# /secrets
resource "aws_api_gateway_resource" "secrets" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "secrets"
}

# /secrets/{itemId}
resource "aws_api_gateway_resource" "secret_item" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.secrets.id
  path_part   = "{itemId}"
}

# /categories
resource "aws_api_gateway_resource" "categories" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "categories"
}

# ------------------------------------------------------------------------------
# 메서드 및 통합 (Lambda Proxy)
# ------------------------------------------------------------------------------

# 공통 모듈: Lambda 통합 설정
locals {
  authorizer_id = aws_api_gateway_authorizer.cognito.id
  lambda_uri    = aws_lambda_function.handler.invoke_arn
}

# GET /secrets (목록 조회)
resource "aws_api_gateway_method" "secrets_get" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.secrets.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = local.authorizer_id
}

resource "aws_api_gateway_integration" "secrets_get" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.secrets.id
  http_method             = aws_api_gateway_method.secrets_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.lambda_uri
}

# POST /secrets (생성)
resource "aws_api_gateway_method" "secrets_post" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.secrets.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = local.authorizer_id
}

resource "aws_api_gateway_integration" "secrets_post" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.secrets.id
  http_method             = aws_api_gateway_method.secrets_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.lambda_uri
}

# GET /secrets/{itemId} (상세 조회)
resource "aws_api_gateway_method" "item_get" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.secret_item.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = local.authorizer_id
}

resource "aws_api_gateway_integration" "item_get" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.secret_item.id
  http_method             = aws_api_gateway_method.item_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.lambda_uri
}

# PUT /secrets/{itemId} (수정)
resource "aws_api_gateway_method" "item_put" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.secret_item.id
  http_method   = "PUT"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = local.authorizer_id
}

resource "aws_api_gateway_integration" "item_put" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.secret_item.id
  http_method             = aws_api_gateway_method.item_put.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.lambda_uri
}

# DELETE /secrets/{itemId} (삭제)
resource "aws_api_gateway_method" "item_delete" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.secret_item.id
  http_method   = "DELETE"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = local.authorizer_id
}

resource "aws_api_gateway_integration" "item_delete" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.secret_item.id
  http_method             = aws_api_gateway_method.item_delete.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.lambda_uri
}

# GET /categories (카테고리 목록)
resource "aws_api_gateway_method" "categories_get" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.categories.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = local.authorizer_id
}

resource "aws_api_gateway_integration" "categories_get" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.categories.id
  http_method             = aws_api_gateway_method.categories_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.lambda_uri
}

# ------------------------------------------------------------------------------
# CORS 설정 (직접 리소스 정의)
# ------------------------------------------------------------------------------

# 공통 응답 헤더 설정 (복합 리소스 관리를 위해 locals 사용)
locals {
  cors_headers = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'https://${var.secret_domain}'"
  }
  cors_response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

# --- /secrets CORS ---
resource "aws_api_gateway_method" "secrets_options" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.secrets.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "secrets_options" {
  rest_api_id       = aws_api_gateway_rest_api.api.id
  resource_id       = aws_api_gateway_resource.secrets.id
  http_method       = aws_api_gateway_method.secrets_options.http_method
  type              = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "secrets_options_200" {
  rest_api_id         = aws_api_gateway_rest_api.api.id
  resource_id         = aws_api_gateway_resource.secrets.id
  http_method         = aws_api_gateway_method.secrets_options.http_method
  status_code         = "200"
  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "secrets_options_200" {
  rest_api_id         = aws_api_gateway_rest_api.api.id
  resource_id         = aws_api_gateway_resource.secrets.id
  http_method         = aws_api_gateway_method.secrets_options.http_method
  status_code         = aws_api_gateway_method_response.secrets_options_200.status_code
  response_parameters = local.cors_headers
}

# --- /secrets/{itemId} CORS ---
resource "aws_api_gateway_method" "item_options" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.secret_item.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "item_options" {
  rest_api_id       = aws_api_gateway_rest_api.api.id
  resource_id       = aws_api_gateway_resource.secret_item.id
  http_method       = aws_api_gateway_method.item_options.http_method
  type              = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "item_options_200" {
  rest_api_id         = aws_api_gateway_rest_api.api.id
  resource_id         = aws_api_gateway_resource.secret_item.id
  http_method         = aws_api_gateway_method.item_options.http_method
  status_code         = "200"
  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "item_options_200" {
  rest_api_id         = aws_api_gateway_rest_api.api.id
  resource_id         = aws_api_gateway_resource.secret_item.id
  http_method         = aws_api_gateway_method.item_options.http_method
  status_code         = aws_api_gateway_method_response.item_options_200.status_code
  response_parameters = local.cors_headers
}

# --- /categories CORS ---
resource "aws_api_gateway_method" "categories_options" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.categories.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "categories_options" {
  rest_api_id       = aws_api_gateway_rest_api.api.id
  resource_id       = aws_api_gateway_resource.categories.id
  http_method       = aws_api_gateway_method.categories_options.http_method
  type              = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "categories_options_200" {
  rest_api_id         = aws_api_gateway_rest_api.api.id
  resource_id         = aws_api_gateway_resource.categories.id
  http_method         = aws_api_gateway_method.categories_options.http_method
  status_code         = "200"
  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "categories_options_200" {
  rest_api_id         = aws_api_gateway_rest_api.api.id
  resource_id         = aws_api_gateway_resource.categories.id
  http_method         = aws_api_gateway_method.categories_options.http_method
  status_code         = aws_api_gateway_method_response.categories_options_200.status_code
  response_parameters = local.cors_headers
}

# ------------------------------------------------------------------------------
# API 배포 및 스테이지
# ------------------------------------------------------------------------------

resource "aws_api_gateway_deployment" "api" {
  rest_api_id = aws_api_gateway_rest_api.api.id

  # 리소스 변경 시 재배포를 트리거하기 위한 트릭
  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.secrets.id,
      aws_api_gateway_resource.secret_item.id,
      aws_api_gateway_resource.categories.id,
      aws_api_gateway_method.secrets_get.id,
      aws_api_gateway_method.secrets_post.id,
      aws_api_gateway_method.item_get.id,
      aws_api_gateway_method.item_put.id,
      aws_api_gateway_method.item_delete.id,
      aws_api_gateway_method.categories_get.id,
      aws_api_gateway_method.secrets_options.id,
      aws_api_gateway_method.item_options.id,
      aws_api_gateway_method.categories_options.id,
      aws_api_gateway_integration.secrets_get.id,
      aws_api_gateway_integration.secrets_post.id,
      aws_api_gateway_integration.item_get.id,
      aws_api_gateway_integration.item_put.id,
      aws_api_gateway_integration.item_delete.id,
      aws_api_gateway_integration.categories_get.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.secrets_get,
    aws_api_gateway_integration.secrets_post,
    aws_api_gateway_integration.item_get,
    aws_api_gateway_integration.item_put,
    aws_api_gateway_integration.item_delete,
    aws_api_gateway_integration.categories_get,
  ]
}

# API Gateway Stage의 액세스 감사 로그를 저장할 CloudWatch 로그 그룹 정의
resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/api-gateway/${var.project_name}-secret-${var.environment}"
  # 소나큐브 보안 권장사항 대응을 위해 보관 주기를 30일로 설정
  retention_in_days = 30

  tags = {
    Name        = "${var.project_name}-secret-api-gateway-logs"
    Environment = var.environment
  }
}

resource "aws_api_gateway_stage" "prod" {
  deployment_id        = aws_api_gateway_deployment.api.id
  rest_api_id          = aws_api_gateway_rest_api.api.id
  stage_name           = var.environment
  # API Gateway X-Ray 추적 활성화 (소나큐브 Traceability 대응 및 모니터링 강화)
  xray_tracing_enabled = true

  # API Gateway 액세스 로깅 활성화 (소나큐브 S6270 대응)
  access_log_settings {
    # 로그가 저장될 CloudWatch 로그 그룹 ARN
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    # 감사 추적을 위한 표준화된 JSON 형식 로그 포맷 정의
    format          = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      caller         = "$context.identity.caller"
      user           = "$context.identity.user"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      resourcePath   = "$context.resourcePath"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
    })
  }
}

# Rate Limiting: Brute Force 및 DDoS 공격 방어를 위한 요청 속도 제한
resource "aws_api_gateway_method_settings" "all" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  stage_name  = aws_api_gateway_stage.prod.stage_name
  # 모든 리소스 및 메서드에 일괄 적용
  method_path = "*/*"

  settings {
    # 순간 최대 동시 요청 수 (버스트 허용량)
    throttling_burst_limit = 50
    # 초당 평균 최대 요청 수 (안정 상태 속도)
    throttling_rate_limit = 100
  }
}

# ------------------------------------------------------------------------------
# 커스텀 도메인 및 Route53 매핑
# ------------------------------------------------------------------------------

# API용 커스텀 도메인 생성
resource "aws_api_gateway_domain_name" "api" {
  domain_name              = "api.${var.secret_domain}"
  regional_certificate_arn = aws_acm_certificate_validation.api.certificate_arn
  security_policy          = "TLS_1_2" # TLS 1.0 및 1.1 차단, TLS 1.2 이상 허용

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

# API Gateway와 커스텀 도메인 매핑
resource "aws_api_gateway_base_path_mapping" "api" {
  api_id      = aws_api_gateway_rest_api.api.id
  stage_name  = aws_api_gateway_stage.prod.stage_name
  domain_name = aws_api_gateway_domain_name.api.domain_name
}

# Route53 A 레코드 (API 도메인 호스팅)
resource "aws_route53_record" "api" {
  name    = aws_api_gateway_domain_name.api.domain_name
  type    = "A"
  zone_id = data.aws_route53_zone.selected.zone_id

  alias {
    name                   = aws_api_gateway_domain_name.api.regional_domain_name
    zone_id                = aws_api_gateway_domain_name.api.regional_zone_id
    evaluate_target_health = false
  }
}

# ------------------------------------------------------------------------------
# API Gateway용 AWS X-Ray 커스텀 샘플링 규칙 정의 (비용 최적화)
# ------------------------------------------------------------------------------
resource "aws_xray_sampling_rule" "api_gateway" {
  # 규칙 이름 식별자 지정 (최대 32자 제한 준수)
  rule_name      = "${var.project_name}-api-xray-${var.environment}"
  # 우선순위 (낮을수록 먼저 매칭)
  priority       = 1000
  version        = 1
  # 초당 무조건 기록할 최소 수집 건수 (초당 1건 보장)
  reservoir_size = 1
  # 초당 최소 보장 건수 이후의 무작위 샘플링 비율 (5%만 수집)
  fixed_rate     = 0.05

  # 와일드카드를 적용하여 API Gateway에서 발생하는 모든 트래픽 매칭
  host            = "*"
  http_method     = "*"
  resource_arn    = "*"
  service_name    = "*"
  service_type    = "*"
  url_path        = "*"

  tags = {
    Name        = "${var.project_name}-xray-sampling-rule"
    Environment = var.environment
  }
}

