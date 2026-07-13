# ==============================================================================
# S3 및 CloudFront 정적 사이트 호스팅
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
# 0. Route53 및 ACM 설정 (us-east-1)
# ------------------------------------------------------------------------------

data "aws_route53_zone" "primary" {
  name         = var.root_domain
  private_zone = false
}

resource "aws_acm_certificate" "blog" {
  provider          = aws.useast1
  domain_name       = var.blog_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "blog_validation" {
  for_each = {
    for dvo in aws_acm_certificate.blog.domain_validation_options : dvo.domain_name => {
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

resource "aws_acm_certificate_validation" "blog" {
  provider                = aws.useast1
  certificate_arn         = aws_acm_certificate.blog.arn
  validation_record_fqdns = [for record in aws_route53_record.blog_validation : record.fqdn]
}

# ------------------------------------------------------------------------------
# 1. S3 버킷 (정적 파일 저장)
# ------------------------------------------------------------------------------

resource "aws_s3_bucket" "frontend" {
  bucket        = "${var.project_name}-blog-frontend-${var.environment}"
  force_destroy = true

  tags = {
    Name = "${var.project_name}-blog-frontend-${var.environment}"
  }
}

# S3 버킷 액세스 로깅 활성화 (소나큐브 Traceability 대응)
resource "aws_s3_bucket_logging" "frontend" {
  # 로깅을 활성화할 대상 버킷 ID
  bucket        = aws_s3_bucket.frontend.id
  # 로그 파일이 저장될 중앙 로그 S3 버킷 ID
  target_bucket = var.infra_log_bucket_id
  # 중앙 로그 버킷 내에서 블로그 프론트엔드 로그가 보관될 접두사
  target_prefix = "s3/blog-frontend/"
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
# 2. CloudFront 보안 헤더 정책
# ------------------------------------------------------------------------------
resource "aws_cloudfront_response_headers_policy" "frontend_security" {
  name    = "${var.project_name}-blog-security-headers-${var.environment}"
  comment = "Security headers for Won-Blog SPA"

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
      content_security_policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com; connect-src 'self' https://*.amazonaws.com https://*.appsync-api.ap-northeast-2.amazonaws.com; img-src 'self' data: https://*.cloudfront.net https://*.s3.ap-northeast-2.amazonaws.com;"
      override                = true
    }
  }
}

# ------------------------------------------------------------------------------
# 3. CloudFront 설정
# ------------------------------------------------------------------------------

# Origin Access Control (OAC)
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.project_name}-blog-oac-${var.environment}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# SPA 라우팅을 위한 URI Rewrite 함수
resource "aws_cloudfront_function" "index_rewrite" {
  name    = "${var.project_name}-blog-rewrite-${var.environment}"
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

  aliases = [var.blog_domain]

  # CloudFront 액세스 로그 설정 (소나큐브 Traceability 대응)
  logging_config {
    # 로그를 저장할 중앙 로그 S3 버킷 도메인
    bucket          = var.infra_log_bucket_domain_name
    # 쿠키 정보 포함 여부
    include_cookies = false
    # 로그 파일이 저장될 S3 버킷 내 접두사
    prefix          = "cloudfront/blog-frontend/"
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

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

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
    acm_certificate_arn      = aws_acm_certificate_validation.blog.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = {
    Name = "${var.project_name}-blog-cf-${var.environment}"
  }
}

# ------------------------------------------------------------------------------
# 4. Route53 Alias 레코드
# ------------------------------------------------------------------------------
resource "aws_route53_record" "blog_alias" {
  zone_id = data.aws_route53_zone.primary.zone_id
  name    = var.blog_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}
