# ==============================================================================
# Terraform Remote Backend용 리소스 정의
# ==============================================================================

# 1. 상태 저장용 S3 버킷
resource "aws_s3_bucket" "state" {
  bucket = var.state_bucket_name

  # 실수로 인한 삭제 방지
  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name        = "Terraform State Storage"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# 1-1. S3 버킷 퍼블릭 액세스 차단 설정 추가 (소나큐브 S6281 대응 및 보안 강화)
resource "aws_s3_bucket_public_access_block" "state" {
  # 대상 S3 버킷 ID 지정
  bucket = aws_s3_bucket.state.id

  # 퍼블릭 ACL 차단
  block_public_acls       = true
  # 퍼블릭 버킷 정책 차단
  block_public_policy     = true
  # 퍼블릭 ACL 무시
  ignore_public_acls      = true
  # 퍼블릭 버킷 제한
  restrict_public_buckets = true
}

# 2. S3 버전 관리 활성화 (과거 상태 복구용)
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

# 3. S3 서버 측 암호화 설정
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# 4. 상태 잠금용 DynamoDB 테이블
resource "aws_dynamodb_table" "lock" {
  name         = var.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = {
    Name        = "Terraform State Locking"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# 5. S3 버킷 HTTPS 전송 강제 정책 추가 (소나큐브 S6249 대응 및 전송 보안)
resource "aws_s3_bucket_policy" "state_https_only" {
  # 대상 S3 버킷 ID 지정
  bucket = aws_s3_bucket.state.id

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
          aws_s3_bucket.state.arn,
          "${aws_s3_bucket.state.arn}/*"
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

# 6. S3 버킷 액세스 로깅 활성화 (소나큐브 Traceability 대응)
resource "aws_s3_bucket_logging" "state" {
  # 로깅을 활성화할 대상 버킷 ID
  bucket        = aws_s3_bucket.state.id
  # 로그 파일이 저장될 중앙 로그 S3 버킷 ID
  target_bucket = var.infra_log_bucket_id
  # 중앙 로그 버킷 내에서 상태 저장용 로그가 보관될 접두사
  target_prefix = "s3/tf-state/"
}
