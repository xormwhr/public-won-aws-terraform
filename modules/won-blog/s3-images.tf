# ==============================================================================
# S3 이미지 저장소 + CloudFront CDN 모듈
# ==============================================================================
#
# [목적]
# - 블로그 게시글에 삽입되는 이미지를 저장하는 S3 버킷
# - CloudFront CDN을 통해 이미지를 빠르고 안전하게 제공
#
# [보안 설계]
# - S3 버킷: 퍼블릭 액세스 완전 차단
# - CloudFront OAC(Origin Access Control): CloudFront만 S3에 접근 가능
# - CORS: 프론트엔드 도메인에서의 업로드만 허용
#
# [비용]
# - S3 프리티어: 5GB 저장, 20,000 GET, 2,000 PUT
# - CloudFront 프리티어: 1TB 전송, 10,000,000 요청
# ==============================================================================

# 현재 AWS 계정 정보 조회
data "aws_caller_identity" "current" {}


# ------------------------------------------------------------------------------
# S3 버킷 생성
# ------------------------------------------------------------------------------
resource "aws_s3_bucket" "images" {
  bucket = "${var.project_name}-${var.environment}-images-${data.aws_caller_identity.current.account_id}"

  # [버킷 이름에 계정 ID 포함]
  # S3 버킷 이름은 글로벌 유일해야 하므로, 계정 ID를 접미사로 추가하여 충돌 방지

  tags = {
    Name        = "${var.project_name}-${var.environment}-images"
    Environment = var.environment
    Purpose     = "BlogImages"
  }
}

# S3 버킷 액세스 로깅 활성화 (소나큐브 Traceability 대응)
resource "aws_s3_bucket_logging" "images" {
  # 로깅을 활성화할 대상 버킷 ID
  bucket        = aws_s3_bucket.images.id
  # 로그 파일이 저장될 중앙 로그 S3 버킷 ID
  target_bucket = var.infra_log_bucket_id
  # 중앙 로그 버킷 내에서 블로그 이미지용 로그가 보관될 접두사
  target_prefix = "s3/blog-images/"
}

# ------------------------------------------------------------------------------
# S3 퍼블릭 액세스 차단
# ------------------------------------------------------------------------------
# CloudFront OAC를 통해서만 접근하므로, 직접 퍼블릭 접근은 모두 차단
resource "aws_s3_bucket_public_access_block" "images" {
  bucket = aws_s3_bucket.images.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ------------------------------------------------------------------------------
# S3 CORS 설정
# ------------------------------------------------------------------------------
# 프론트엔드에서 S3로 직접 이미지를 업로드하기 위한 CORS 허용
resource "aws_s3_bucket_cors_configuration" "images" {
  bucket = aws_s3_bucket.images.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "POST", "GET", "HEAD"]
    allowed_origins = var.allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

# ------------------------------------------------------------------------------
# CloudFront Origin Access Control (OAC)
# ------------------------------------------------------------------------------
# [OAC vs OAI]
# - OAI (레거시): 서명 v2, 일부 S3 기능 미지원
# - OAC (신규 권장): 서명 v4, SSE-KMS 등 모든 S3 기능 지원
resource "aws_cloudfront_origin_access_control" "images" {
  name                              = "${var.project_name}-${var.environment}-images-oac"
  description                       = "OAC for blog images S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ------------------------------------------------------------------------------
# AWS 관리형 캐시 정책 조회
# ------------------------------------------------------------------------------
# 하드코딩된 ID 대신 data source로 안전하게 조회
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

# ------------------------------------------------------------------------------
# CloudFront Distribution
# ------------------------------------------------------------------------------
resource "aws_cloudfront_distribution" "images" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project_name}-${var.environment} Blog Images CDN"
  default_root_object = ""
  price_class         = "PriceClass_200" # 아시아/유럽/북미 (비용 절감)

  # CloudFront 액세스 로그 설정 (소나큐브 Traceability 대응)
  logging_config {
    # 로그를 저장할 중앙 로그 S3 버킷 도메인
    bucket          = var.infra_log_bucket_domain_name
    # 쿠키 정보 포함 여부
    include_cookies = false
    # 로그 파일이 저장될 S3 버킷 내 접두사
    prefix          = "cloudfront/blog-images/"
  }

  # [PriceClass 옵션]
  # - PriceClass_All: 모든 엣지 (최고 성능, 최고 비용)
  # - PriceClass_200: 아시아 포함 대부분 (적절한 균형)
  # - PriceClass_100: 북미/유럽만 (최저 비용)
  # → 한국 사용자 대상이므로 PriceClass_200 선택

  # S3 Origin 설정
  origin {
    domain_name              = aws_s3_bucket.images.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.images.id
    origin_id                = "S3-${aws_s3_bucket.images.id}"
  }

  # 기본 캐시 동작
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.images.id}"
    viewer_protocol_policy = "redirect-to-https"

    # 캐시 정책 (CachingOptimized - AWS 관리형, data source로 조회)
    cache_policy_id = data.aws_cloudfront_cache_policy.caching_optimized.id

    compress = true # Gzip/Brotli 압축 활성화
  }

  # 지역 제한 (없음)
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # SSL 인증서 (CloudFront 기본 인증서)
  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-images-cdn"
    Environment = var.environment
  }
}

# ------------------------------------------------------------------------------
# S3 버킷 정책 (CloudFront OAC만 허용 및 HTTPS 강제 정책 추가)
# ------------------------------------------------------------------------------
resource "aws_s3_bucket_policy" "images" {
  bucket = aws_s3_bucket.images.id

  # public_access_block이 먼저 적용되어야 함
  depends_on = [aws_s3_bucket_public_access_block.images]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # CloudFront 서비스 주체의 버킷 내 객체 읽기 허용 규칙
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.images.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.images.arn
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
          aws_s3_bucket.images.arn,
          "${aws_s3_bucket.images.arn}/*"
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
