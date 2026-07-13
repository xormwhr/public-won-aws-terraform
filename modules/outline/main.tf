# ==============================================================================
# Outline 파일 업로드용 S3 버킷
# ==============================================================================

resource "aws_s3_bucket" "outline" {
  bucket = "${var.project_name}-outline-uploads-${var.environment}"

  tags = {
    Name        = "${var.project_name}-outline-uploads"
    Environment = var.environment
    Service     = "outline"
  }
}

# 퍼블릭 접근 완전 차단 (Outline이 presigned URL로 파일 제공)
resource "aws_s3_bucket_public_access_block" "outline" {
  bucket = aws_s3_bucket.outline.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ACL 비활성화 (S3 최신 기본 정책)
resource "aws_s3_bucket_ownership_controls" "outline" {
  bucket = aws_s3_bucket.outline.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# CORS 설정 (Outline 프론트엔드에서 파일 업로드 허용)
resource "aws_s3_bucket_cors_configuration" "outline" {
  bucket = aws_s3_bucket.outline.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST"]
    allowed_origins = ["https://${var.outline_domain}"]
    max_age_seconds = 3000
  }
}

# S3 버킷 HTTPS 전송 강제 정책 추가 (소나큐브 S6249 대응 및 전송 보안)
resource "aws_s3_bucket_policy" "outline_https_only" {
  # 대상 S3 버킷 ID 지정
  bucket = aws_s3_bucket.outline.id

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
          aws_s3_bucket.outline.arn,
          "${aws_s3_bucket.outline.arn}/*"
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

# S3 버킷 액세스 로깅 활성화 (소나큐브 Traceability 대응)
resource "aws_s3_bucket_logging" "outline" {
  # 로깅을 활성화할 대상 버킷 ID
  bucket        = aws_s3_bucket.outline.id
  # 로그 파일이 저장될 중앙 로그 S3 버킷 ID
  target_bucket = var.infra_log_bucket_id
  # 중앙 로그 버킷 내에서 Outline 업로드용 로그가 보관될 접두사
  target_prefix = "s3/outline-uploads/"
}
