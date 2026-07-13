# ==============================================================================
# Outline S3 접근용 IAM User 및 Policy
# ==============================================================================

resource "aws_iam_user" "outline" {
  name = "${var.project_name}-outline-s3-user-${var.environment}"

  tags = {
    Name        = "outline-s3-user"
    Environment = var.environment
    Service     = "outline"
  }
}

resource "aws_iam_user_policy" "outline_s3" {
  name = "${var.project_name}-outline-s3-policy-${var.environment}"
  user = aws_iam_user.outline.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.outline.arn,
          "${aws_s3_bucket.outline.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_access_key" "outline" {
  user = aws_iam_user.outline.name
}
