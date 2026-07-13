# ==============================================================================
# Cognito Identity Pool 모듈
# ==============================================================================
#
# [Cognito Identity Pool이란?]
# - User Pool과는 별개의 서비스
# - User Pool: 인증 (누구인지 확인) → JWT 토큰 발급
# - Identity Pool: 인가 (무엇을 할 수 있는지) → AWS 임시 자격증명 발급
#
# [왜 Identity Pool이 필요한가?]
# - 프론트엔드에서 S3에 직접 파일을 업로드하려면 AWS 자격증명이 필요
# - Identity Pool이 Cognito 인증 토큰을 AWS IAM 임시 자격증명으로 교환
# - 이를 통해 Lambda 없이도 클라이언트에서 S3에 안전하게 업로드 가능
#
# [흐름]
# 1. 사용자 로그인 → Cognito User Pool이 JWT 발급
# 2. JWT를 Identity Pool에 전달 → AWS 임시 자격증명 발급
# 3. 임시 자격증명으로 S3 PutObject 실행
# ==============================================================================

# 현재 리전 조회


# ------------------------------------------------------------------------------
# Cognito Identity Pool
# ------------------------------------------------------------------------------
resource "aws_cognito_identity_pool" "main" {
  identity_pool_name               = "${var.project_name}-${var.environment}-identity-pool"
  allow_unauthenticated_identities = false # 인증된 사용자만 허용
  allow_classic_flow               = false # Enhanced Flow만 사용 (보안 강화)

  # Cognito User Pool을 인증 프로바이더로 연결
  cognito_identity_providers {
    client_id               = var.cognito_user_pool_client_id
    provider_name           = "cognito-idp.${data.aws_region.current.region}.amazonaws.com/${var.cognito_user_pool_id}"
    server_side_token_check = true # 토큰 서버 측 검증 활성화
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-identity-pool"
    Environment = var.environment
  }
}

# ------------------------------------------------------------------------------
# IAM Role - 인증된 사용자용 (S3 업로드 권한)
# ------------------------------------------------------------------------------
resource "aws_iam_role" "authenticated" {
  name = "${var.project_name}-${var.environment}-cognito-authenticated-role"

  # [Assume Role Policy]
  # Cognito Identity Pool이 이 역할을 위임(Assume)할 수 있도록 허용
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = "cognito-identity.amazonaws.com"
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "cognito-identity.amazonaws.com:aud" = aws_cognito_identity_pool.main.id
          }
          "ForAnyValue:StringLike" = {
            "cognito-identity.amazonaws.com:amr" = "authenticated"
          }
        }
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-${var.environment}-cognito-authenticated-role"
  }
}

# ------------------------------------------------------------------------------
# IAM Policy - S3 이미지 업로드 권한
# ------------------------------------------------------------------------------
resource "aws_iam_role_policy" "authenticated_s3" {
  name = "${var.project_name}-${var.environment}-cognito-s3-upload-policy"
  role = aws_iam_role.authenticated.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # 이미지 및 썸네일 업로드 허용 (images/, thumbnails/ 경로 하위만)
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject"
        ]
        Resource = [
          "${aws_s3_bucket.images.arn}/images/*",
          "${aws_s3_bucket.images.arn}/thumbnails/*"
        ]
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# Identity Pool Role Attachment
# ------------------------------------------------------------------------------
# Identity Pool에 IAM Role을 연결
resource "aws_cognito_identity_pool_roles_attachment" "main" {
  identity_pool_id = aws_cognito_identity_pool.main.id

  roles = {
    "authenticated" = aws_iam_role.authenticated.arn
  }
}
