# ==============================================================================
# GitHub Actions OIDC 배포를 위한 IAM 역할 및 정책
# ==============================================================================

# 1. GitHub Actions용 임시 자격 증명을 획득하기 위한 IAM 역할 생성
resource "aws_iam_role" "github_actions_role" {
  name        = "${var.project_name}-secret-github-actions-role-${var.environment}"
  description = "IAM Role for GitHub Actions OIDC deployment of won-secret (${var.environment})"

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
            # 보안 강화를 위해 리포지토리 대상을 won-secret으로 제한합니다.
            "token.actions.githubusercontent.com:sub" = "repo:your-github-id/won-secret:*"
          }
        }
      }
    ]
  })
}

# 2. IAM 역할에 S3 업로드 및 CloudFront 캐시 무효화 권한을 명시적으로 허용하는 정책 부여
resource "aws_iam_role_policy" "github_actions_policy" {
  name = "${var.project_name}-secret-github-actions-policy-${var.environment}"
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
          aws_s3_bucket.frontend.arn,
          "${aws_s3_bucket.frontend.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "cloudfront:CreateInvalidation"
        ]
        Resource = [
          aws_cloudfront_distribution.frontend.arn
        ]
      }
    ]
  })
}
