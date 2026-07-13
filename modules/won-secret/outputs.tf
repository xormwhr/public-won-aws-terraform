# ==============================================================================
# Won-Secret 모듈 출력 변수
# ==============================================================================

output "api_url" {
  description = "API Gateway 엔드포인트 URL"
  value       = "https://api.${var.secret_domain}"
}

output "cloudfront_distribution_id" {
  description = "CloudFront 배포 ID"
  value       = aws_cloudfront_distribution.frontend.id
}

output "cloudfront_url" {
  description = "CloudFront 도메인 이름"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "s3_bucket_name" {
  description = "프론트엔드 정적 파일용 S3 버킷 이름"
  value       = aws_s3_bucket.frontend.id
}

output "cognito_user_pool_id" {
  description = "재사용된 Cognito User Pool ID"
  value       = var.cognito_user_pool_id
}

output "cognito_client_id" {
  description = "Won-Secret용 Cognito App Client ID"
  value       = aws_cognito_user_pool_client.client.id
}

output "kms_key_id" {
  description = "필드 단위 암호화용 KMS 키 ID"
  value       = aws_kms_key.field_encryption.key_id
}

output "github_actions_role_arn" {
  description = "GitHub Actions OIDC 배포를 위해 생성된 IAM 역할(Role) ARN"
  value       = aws_iam_role.github_actions_role.arn
}
