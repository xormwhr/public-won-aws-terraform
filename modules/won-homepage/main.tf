# ==============================================================================
# 파일명: main.tf
# 경로: modules/won-homepage/main.tf
# 설명: S3 호스팅 버킷, ACM 멀티 도메인 인증서, CloudFront OAC & CDN 배포 구성
# ==============================================================================

terraform {
  # CloudFront 인증서 생성을 위해 us-east-1 리전의 공급자 별칭이 필수적입니다.
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.useast1]
    }
  }
}

# ------------------------------------------------------------------------------
# 1. S3 버킷 설정 (홈페이지 정적 정적 파일 자산 보관)
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
  # 중앙 로그 버킷 내에서 홈페이지 로그가 보관될 접두사
  target_prefix = "s3/homepage-frontend/"
}

# S3 퍼블릭 액세스 차단 블록 구성 (보안 유지 및 OAC 접속만 강제화)
resource "aws_s3_bucket_public_access_block" "pab" {
  bucket = aws_s3_bucket.bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ------------------------------------------------------------------------------
# 2. Route53 호스팅 영역 정보 조회 및 ACM 인증서 발급
# ------------------------------------------------------------------------------
data "aws_route53_zone" "primary" {
  name         = var.root_domain
  private_zone = false
}

# CloudFront 배포에 활용할 멀티도메인 ACM 인증서 (us-east-1) 생성
resource "aws_acm_certificate" "cert" {
  provider                  = aws.useast1
  domain_name               = var.root_domain
  subject_alternative_names = ["www.${var.root_domain}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# ACM 도메인 소유권 DNS 검증용 Route53 레코드 생성
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

# 인증서 실제 검증 완료 대기 정의
resource "aws_acm_certificate_validation" "cert_val" {
  provider                = aws.useast1
  certificate_arn         = aws_acm_certificate.cert.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# ------------------------------------------------------------------------------
# 3. CloudFront OAC 및 CDN 배포 환경 구축
# ------------------------------------------------------------------------------
# S3 접근 제어 보안을 위한 OAC 생성
resource "aws_cloudfront_origin_access_control" "oac" {
  name                              = "${var.project_name}-homepage-oac-${var.environment}"
  description                       = "OAC for ${var.project_name} Homepage S3 Bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CloudFront 배포판(CDN) 정의
resource "aws_cloudfront_distribution" "cdn" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project_name} Homepage S3 CDN (${var.environment})"
  default_root_object = "index.html"

  aliases = [var.root_domain, "www.${var.root_domain}"]

  # CloudFront 액세스 로그 설정 (소나큐브 Traceability 대응)
  logging_config {
    # 로그를 저장할 중앙 로그 S3 버킷 도메인
    bucket          = var.infra_log_bucket_domain_name
    # 쿠키 정보 포함 여부
    include_cookies = false
    # 로그 파일이 저장될 S3 버킷 내 접두사
    prefix          = "cloudfront/homepage-frontend/"
  }

  # 오리진 1: S3 정적 자산 보관소
  origin {
    domain_name              = aws_s3_bucket.bucket.bucket_regional_domain_name
    origin_id                = aws_s3_bucket.bucket.id
    origin_access_control_id = aws_cloudfront_origin_access_control.oac.id
  }

  # 오리진 2: API Proxy Lambda (Function URL)
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
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # AllViewerExceptHostHeader

    response_headers_policy_id = "67f7725c-6f97-4210-82d7-5512b31e9d03"
  }

  # 규칙 1: /api/* 경로는 API Proxy Lambda로 오리진 라우팅 (캐시 비활성화)
  ordered_cache_behavior {
    path_pattern     = "/api/*"
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "lambda-api-proxy"

    viewer_protocol_policy = "redirect-to-https"

    # CachingDisabled 관리 정책 ID 지정
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"

    # AllViewerExceptHostHeader 관리 정책 ID 지정
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"

    # AWS 관리형 보안 헤더 정송 정책 적용 (SecurityHeadersPolicy)
    # 포함 헤더: Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy
    response_headers_policy_id = "67f7725c-6f97-4210-82d7-5512b31e9d03"
  }

  # 규칙 2: 기본 캐시 동작 - S3 호스팅 웹서버 라우팅
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = aws_s3_bucket.bucket.id

    viewer_protocol_policy = "redirect-to-https"
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # CachingOptimized

    # AWS 관리형 보안 헤더 정송 정책 적용 (SecurityHeadersPolicy)
    # 포함 헤더: Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy
    response_headers_policy_id = "67f7725c-6f97-4210-82d7-5512b31e9d03"

    # www 리다이렉션 및 Trailing slash 리라이트를 위한 CF Function 연결
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.routing_function.arn
    }
  }

  # S3 정적 라우팅 지원을 위한 오류 대체(Fallback) 구성
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
# 4. S3 버킷 OAC 접근 허용을 위한 버킷 정책 생성 및 적용
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
# 5. Route 53 도메인 A 레코드 매핑 (루트 & www 동시 Alias)
# ------------------------------------------------------------------------------
resource "aws_route53_record" "root_alias" {
  zone_id = data.aws_route53_zone.primary.zone_id
  name    = var.root_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.cdn.domain_name
    zone_id                = aws_cloudfront_distribution.cdn.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www_alias" {
  zone_id = data.aws_route53_zone.primary.zone_id
  name    = "www.${var.root_domain}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.cdn.domain_name
    zone_id                = aws_cloudfront_distribution.cdn.hosted_zone_id
    evaluate_target_health = false
  }
}

# ------------------------------------------------------------------------------
# 6. CloudFront Function (www 리다이렉션 & 디렉토리 index.html 리라이트)
# ------------------------------------------------------------------------------
resource "aws_cloudfront_function" "routing_function" {
  name    = "${var.project_name}-homepage-routing-${var.environment}"
  runtime = "cloudfront-js-2.0"
  comment = "Redirect www.example.com to example.com and handle directory rewrites"
  publish = true
  code    = <<EOF
function handler(event) {
    var request = event.request;
    var host = request.headers.host.value;
    var uri = request.uri;

    // www 도메인 접속 요청 감지 시 루트 도메인(example.com)으로 301 영구 리다이렉트
    if (host.startsWith('www.')) {
        var cleanHost = host.replace(/^www\./, '');
        return {
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                'location': { value: 'https://' + cleanHost + uri }
            }
        };
    }

    // /api/* 경로는 API Proxy Lambda로 그대로 라우팅 (리라이트 적용 안함)
    if (uri.startsWith('/api/')) {
        return request;
    }

    // 디렉토리 엔드포인트 요청 시 index.html 대응 리라이트
    if (uri.endsWith('/')) {
        request.uri += 'index.html';
    }
    // 확장자가 없고 슬래시가 누락된 파일 경로 보정
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
  name        = "${var.project_name}-homepage-github-actions-role-${var.environment}"
  description = "IAM Role for GitHub Actions OIDC deployment of won-homepage (${var.environment})"

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
            "token.actions.githubusercontent.com:sub" = "repo:your-github-id/*"
          }
        }
      }
    ]
  })
}

# IAM Role에 S3 업로드 및 CloudFront 캐시 무효화 권한을 명시적으로 허용하는 정책(Policy) 부여
resource "aws_iam_role_policy" "github_actions_policy" {
  name = "${var.project_name}-homepage-github-actions-policy-${var.environment}"
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

# AWS 비용 API 전용 1일 강제 캐시 정책 정의
resource "aws_cloudfront_cache_policy" "aws_cost_cache_policy" {
  name        = "${var.project_name}-homepage-aws-cost-cache-policy-${var.environment}"
  comment     = "Cache policy for AWS Cost API of won-homepage (${var.environment})"
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
