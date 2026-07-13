# ==============================================================================
# S3 및 CloudFront 정적 사이트 호스팅
# ==============================================================================

# ------------------------------------------------------------------------------
# S3 버킷 (정적 파일 저장)
# ------------------------------------------------------------------------------

resource "aws_s3_bucket" "frontend" {
  bucket        = "${var.project_name}-secret-frontend-${var.environment}"
  force_destroy = true

  tags = {
    Name = "${var.project_name}-secret-frontend-${var.environment}"
  }
}

# S3 버킷 액세스 로깅 활성화 (소나큐브 Traceability 대응)
resource "aws_s3_bucket_logging" "frontend" {
  # 로깅을 활성화할 대상 버킷 ID
  bucket        = aws_s3_bucket.frontend.id
  # 로그 파일이 저장될 중앙 로그 S3 버킷 ID
  target_bucket = var.infra_log_bucket_id
  # 중앙 로그 버킷 내에서 Secret 프론트엔드 로그가 보관될 접두사
  target_prefix = "s3/secret-frontend/"
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudFront가 S3에 접근할 수 있도록 허용하는 정책 (HTTPS 강제 정책 추가)
resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # CloudFront 읽기 전용 접근 허용 규칙
      {
        Sid    = "AllowCloudFrontServicePrincipalReadOnly"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.frontend.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      },
      # HTTPS 전송 강제 규칙 추가 (소나큐브 S6249 대응)
      {
        Sid       = "EnforceHTTPSOnly"
        Effect    = "Deny"
        Principal = {
          AWS = "*"
        }
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.frontend.arn,
          "${aws_s3_bucket.frontend.arn}/*"
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

# ------------------------------------------------------------------------------
# 2. Route53 및 ACM (us-east-1)
# ------------------------------------------------------------------------------

# CloudFront용 ACM 인증서 (us-east-1)
resource "aws_acm_certificate" "cert" {
  provider          = aws.useast1
  domain_name       = var.secret_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${var.project_name}-secret-frontend-cert-${var.environment}"
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
  zone_id         = data.aws_route53_zone.selected.zone_id
}

resource "aws_acm_certificate_validation" "cert" {
  provider                = aws.useast1
  certificate_arn         = aws_acm_certificate.cert.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# ------------------------------------------------------------------------------
# 3. CloudFront 보안 헤더 정책
# ------------------------------------------------------------------------------
resource "aws_cloudfront_response_headers_policy" "frontend_security" {
  name    = "${var.project_name}-security-headers-${var.environment}"
  comment = "Security headers for Won-Secret SPA"

  security_headers_config {
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_security_policy {
      # unsafe-eval: Next.js 정적 빌드(output: "export")는 eval()을 사용하지 않으므로 제거 유지
      # unsafe-inline(script): Next.js가 __NEXT_DATA__ 등 런타임 데이터를 인라인 <script>로 HTML에 직접
      #   삽입하므로 정적 빌드(output: "export") 환경에서는 필수.
      #   nonce 기반 CSP는 SSR(서버 렌더링)이 필요하여 적용 불가.
      #   SHA256 해시 기반은 빌드마다 해시값이 변경되어 유지보수 불가.
      # unsafe-inline(style): CSS-in-JS 및 Next.js 인라인 스타일 삽입에 필요하여 유지
      content_security_policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://cognito-idp.${data.aws_region.current.region}.amazonaws.com https://api.${var.secret_domain}; img-src 'self' data:;"
      override                = true
    }
  }
}

# ------------------------------------------------------------------------------
# 4. CloudFront 설정
# ------------------------------------------------------------------------------

# Origin Access Control (OAC)
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.project_name}-secret-oac-${var.environment}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# SPA 라우팅을 위한 URI Rewrite 함수
resource "aws_cloudfront_function" "index_rewrite" {
  name    = "${var.project_name}-secret-rewrite-${var.environment}"
  runtime = "cloudfront-js-2.0"
  comment = "SPA routing rewrite for Next.js"
  publish = true
  code    = <<EOF
function handler(event) {
    var request = event.request;
    var uri = request.uri;

    // 파일 확장자가 없는 경로인 경우 (폴더/라우트) index.html로 리다이렉트 시도
    if (!uri.includes('.')) {
        if (uri.endsWith('/')) {
            request.uri += 'index.html';
        } else {
            request.uri += '.html';
        }
    }

    return request;
}
EOF
}

# CloudFront 배포
resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  aliases             = [var.secret_domain]

  # CloudFront 액세스 로그 설정 (소나큐브 Traceability 대응)
  logging_config {
    # 로그를 저장할 중앙 로그 S3 버킷 도메인
    bucket          = var.infra_log_bucket_domain_name
    # 쿠키 정보 포함 여부
    include_cookies = false
    # 로그 파일이 저장될 S3 버킷 내 접두사
    prefix          = "cloudfront/secret-frontend/"
  }

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "S3-${aws_s3_bucket.frontend.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-${aws_s3_bucket.frontend.id}"

    response_headers_policy_id = aws_cloudfront_response_headers_policy.frontend_security.id

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.index_rewrite.arn
    }
  }

  # 403 에러 시 index.html로 응답 (S3 객체 미발견 시 403 반환 대응)
  # error_caching_min_ttl = 0: RSC payload(.txt) 요청이 배포 타이밍에 일시 실패해도
  # 에러 응답을 캐시하지 않아 다음 요청에서 정상 파일을 서빙할 수 있다.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  # 404 에러 시 index.html로 응답 (SPA 라우팅 보완)
  # error_caching_min_ttl = 0: 동일 이유로 에러 응답 캐시 비활성화
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.cert.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = {
    Name = "${var.project_name}-secret-cf-${var.environment}"
  }
}

# ------------------------------------------------------------------------------
# Route53 레코드 (프론트엔드 도메인 호스팅)
# ------------------------------------------------------------------------------

resource "aws_route53_record" "frontend" {
  name    = var.secret_domain
  type    = "A"
  zone_id = data.aws_route53_zone.selected.zone_id

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}
