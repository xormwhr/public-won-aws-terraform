# ==============================================================================
# Outline 모듈 출력값
# ==============================================================================

output "s3_bucket_name" {
  description = "Outline 파일 업로드용 S3 버킷 이름"
  value       = aws_s3_bucket.outline.id
}

output "iam_access_key_id" {
  description = "Outline S3 접근 IAM Access Key ID"
  value       = aws_iam_access_key.outline.id
}

output "iam_secret_access_key" {
  description = "Outline S3 접근 IAM Secret Access Key"
  value       = aws_iam_access_key.outline.secret
  sensitive   = true
}

output "cognito_client_id" {
  description = "Outline OIDC Cognito App Client ID"
  value       = aws_cognito_user_pool_client.outline.id
}

output "cognito_client_secret" {
  description = "Outline OIDC Cognito App Client Secret"
  value       = aws_cognito_user_pool_client.outline.client_secret
  sensitive   = true
}

output "cognito_domain" {
  description = "Cognito OAuth 2.0 도메인 URL"
  value       = "https://${var.cognito_domain_prefix}.auth.${var.aws_region}.amazoncognito.com"
}
