# ==============================================================================
# Static Site 리소스 구성 (S3 + CloudFront + Route53)
# ==============================================================================

terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.useast1]
    }
  }
}

# ------------------------------------------------------------------------------
# 1. S3 버킷 설정 (고정 접미사 사용)
# ------------------------------------------------------------------------------
resource "aws_s3_bucket" "bucket" {
  bucket = "${var.bucket_name_prefix}-${var.environment}-${var.bucket_suffix}"
}

# S3 버킷 액세스 로깅 활성화 (소나큐브 Traceability 대응)
resource "aws_s3_bucket_logging" "bucket" {
  # 로깅을 활성화할 대상 버킷 ID
  bucket        = aws_s3_bucket.bucket.id
  # 로그 파일이 저장될 중앙 로그 S3 버킷 ID
  target_bucket = var.infra_log_bucket_id
  # 중앙 로그 버킷 내에서 대시보드 프론트엔드 로그가 보관될 접두사
  target_prefix = "s3/dashboard-frontend/"
}

resource "aws_s3_bucket_public_access_block" "pab" {
  bucket = aws_s3_bucket.bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ------------------------------------------------------------------------------
# 2. Route53 및 ACM (us-east-1)
# ------------------------------------------------------------------------------
data "aws_route53_zone" "primary" {
  name         = var.root_domain
  private_zone = false
}

resource "aws_acm_certificate" "cert" {
  provider          = aws.useast1
  domain_name       = var.dashboard_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.cert.domain_validation_options : dvo.domain_name => {
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
  zone_id         = data.aws_route53_zone.primary.zone_id
}

resource "aws_acm_certificate_validation" "cert_val" {
  provider                = aws.useast1
  certificate_arn         = aws_acm_certificate.cert.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# ------------------------------------------------------------------------------
# 3. CloudFront 및 OAC
# ------------------------------------------------------------------------------
resource "aws_cloudfront_origin_access_control" "oac" {
  name                              = "${var.project_name}-oac-${var.environment}"
  description                       = "OAC for ${var.project_name} S3 Bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "cdn" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project_name} S3 CDN (${var.environment})"
  default_root_object = "index.html"

  aliases = [var.dashboard_domain]

  # CloudFront 액세스 로그 설정 (소나큐브 Traceability 대응)
  logging_config {
    # 로그를 저장할 중앙 로그 S3 버킷 도메인
    bucket          = var.infra_log_bucket_domain_name
    # 쿠키 정보 포함 여부
    include_cookies = false
    # 로그 파일이 저장될 S3 버킷 내 접두사
    prefix          = "cloudfront/dashboard-frontend/"
  }

  origin {
    domain_name              = aws_s3_bucket.bucket.bucket_regional_domain_name
    origin_id                = aws_s3_bucket.bucket.id
    origin_access_control_id = aws_cloudfront_origin_access_control.oac.id
  }

  # Lambda API Proxy 오리진
  origin {
    domain_name = replace(replace(aws_lambda_function_url.api_proxy_url.function_url, "https://", ""), "/", "")
    origin_id   = "lambda-api-proxy"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # 규칙 0: /api/aws-cost 경로는 1일 동안 강력한 캐싱 정책 적용 (비용 절감)
  ordered_cache_behavior {
    path_pattern     = "/api/aws-cost"
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "lambda-api-proxy"

    viewer_protocol_policy = "redirect-to-https"

    cache_policy_id          = aws_cloudfront_cache_policy.aws_cost_cache_policy.id
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  }

  # /api/* 경로는 Lambda로 라우팅 (캐싱 비활성화)
  # 주의: custom_error_response(403/404)는 S3 정적 파일 오류용이며,
  #        /api/* 경로의 Lambda 응답 오류는 Lambda에서 직접 JSON으로 반환해야 함.
  #        Lambda가 정상적으로 응답하면 CloudFront는 그 응답을 그대로 전달함.
  ordered_cache_behavior {
    path_pattern     = "/api/*"
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "lambda-api-proxy"

    viewer_protocol_policy = "redirect-to-https"

    # CachingDisabled 관리형 정책 ID
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"

    # AllViewerExceptHostHeader 관리형 정책 ID
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = aws_s3_bucket.bucket.id

    viewer_protocol_policy = "redirect-to-https"
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # CachingOptimized

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.index_rewrite.arn
    }
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.cert_val.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ------------------------------------------------------------------------------
# 4. S3 버킷 정책
# ------------------------------------------------------------------------------
data "aws_iam_policy_document" "s3_policy" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.bucket.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.cdn.arn]
    }
  }

  # 한글 설명 주석: HTTPS 전송이 강제되도록 처리하여 소나큐브 S6249 보안 요구 사항 충족
  statement {
    sid       = "EnforceHTTPSOnly"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [
      aws_s3_bucket.bucket.arn,
      "${aws_s3_bucket.bucket.arn}/*"
    ]
    principals {
      type        = "AWS"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "bucket_policy" {
  bucket = aws_s3_bucket.bucket.id
  policy = data.aws_iam_policy_document.s3_policy.json
}

# ------------------------------------------------------------------------------
# 5. Route53 Alias
# ------------------------------------------------------------------------------
resource "aws_route53_record" "alias" {
  zone_id = data.aws_route53_zone.primary.zone_id
  name    = var.dashboard_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.cdn.domain_name
    zone_id                = aws_cloudfront_distribution.cdn.hosted_zone_id
    evaluate_target_health = false
  }
}

# ------------------------------------------------------------------------------
# 6. CloudFront Function (URL Rewrite)
# ------------------------------------------------------------------------------
resource "aws_cloudfront_function" "index_rewrite" {
  name    = "${var.project_name}-index-rewrite-${var.environment}"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite directory requests to index.html"
  publish = true
  code    = <<EOF
function handler(event) {
    var request = event.request;
    var uri = request.uri;

    // /api/* 경로는 Lambda로 직접 전달 (리라이트 없음)
    if (uri.startsWith('/api/')) {
        return request;
    }

    // 디렉토리 요청이면 index.html 추가
    if (uri.endsWith('/')) {
        request.uri += 'index.html';
    }
    // 파일 확장자가 없고 마지막이 /가 아니면 index.html 추가 (trailingSlash 대응)
    else if (!uri.includes('.')) {
        request.uri += '/index.html';
    }

    return request;
}
EOF
}



# ------------------------------------------------------------------------------
# 8. GitHub Actions OIDC 배포를 위한 IAM Role 및 Policy 구성
# ------------------------------------------------------------------------------
# GitHub Actions용 임시 자격 증명을 획득하기 위한 IAM Role 생성
resource "aws_iam_role" "github_actions_role" {
  name        = "${var.project_name}-dashboard-github-actions-role-${var.environment}"
  description = "IAM Role for GitHub Actions OIDC deployment of won-dashboard (${var.environment})"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRoleWithWebIdentity"
        Effect = "Allow"
        Principal = {
          Federated = var.github_oidc_provider_arn
        }
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:your-github-id/won-dashboard:*"
          }
        }
      }
    ]
  })
}

# IAM Role에 S3 업로드 및 CloudFront 캐시 무효화 권한을 명시적으로 허용하는 정책(Policy) 부여
resource "aws_iam_role_policy" "github_actions_policy" {
  name = "${var.project_name}-dashboard-github-actions-policy-${var.environment}"
  role = aws_iam_role.github_actions_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:DeleteObject"
        ]
        Resource = [
          aws_s3_bucket.bucket.arn,
          "${aws_s3_bucket.bucket.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "cloudfront:CreateInvalidation"
        ]
        Resource = [
          aws_cloudfront_distribution.cdn.arn
        ]
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# 9. AWS 리소스 모니터링 전용 설정 파라미터 (자격 증명 미포함)
# ------------------------------------------------------------------------------
resource "aws_ssm_parameter" "aws_resources_s3_bucket" {
  name        = "/won-dashboard/aws-resources-s3-bucket"
  description = "S3 state bucket name for AWS resources monitoring"
  type        = "String"
  value       = var.aws_resources_s3_bucket

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "aws_resources_s3_key" {
  name        = "/won-dashboard/aws-resources-s3-key"
  description = "S3 state key for AWS resources monitoring"
  type        = "String"
  value       = var.aws_resources_s3_key

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "aws_resources_region" {
  name        = "/won-dashboard/aws-resources-region"
  description = "S3 state region for AWS resources monitoring"
  type        = "String"
  value       = var.aws_resources_region

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }

  lifecycle { ignore_changes = [value] }
}

# AWS 비용 API 전용 1일 강제 캐시 정책 정의
resource "aws_cloudfront_cache_policy" "aws_cost_cache_policy" {
  name        = "${var.project_name}-dashboard-aws-cost-cache-policy-${var.environment}"
  comment     = "Cache policy for AWS Cost API of won-dashboard (${var.environment})"
  default_ttl = 86400
  max_ttl     = 86400
  min_ttl     = 86400

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

# AWS 비용 캐시용 S3 버킷 정의
# 한글 설명 주석: project_name 변수를 접두사로 활용하여 버킷명을 구성합니다.
resource "aws_s3_bucket" "cost_cache" {
  bucket        = "${var.project_name}-cost-cache-${var.environment}"
  force_destroy = true
}

# S3 버킷 액세스 로깅 활성화 (소나큐브 Traceability 대응)
resource "aws_s3_bucket_logging" "cost_cache" {
  # 로깅을 활성화할 대상 버킷 ID
  bucket        = aws_s3_bucket.cost_cache.id
  # 로그 파일이 저장될 중앙 로그 S3 버킷 ID
  target_bucket = var.infra_log_bucket_id
  # 중앙 로그 버킷 내에서 대시보드 비용 캐시용 로그가 보관될 접두사
  target_prefix = "s3/dashboard-cost-cache/"
}

resource "aws_s3_bucket_public_access_block" "cost_cache_pab" {
  bucket                  = aws_s3_bucket.cost_cache.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# HTTPS 전송 강제 정책 추가 (소나큐브 S6249 대응 및 전송 보안)
resource "aws_s3_bucket_policy" "cost_cache_https_only" {
  # 대상 S3 버킷 ID 지정
  bucket = aws_s3_bucket.cost_cache.id

  # HTTPS 강제 접근 제어 정책 정의
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
          aws_s3_bucket.cost_cache.arn,
          "${aws_s3_bucket.cost_cache.arn}/*"
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

