# ==============================================================================
# Static Site 모듈 출력값
# ==============================================================================

output "bucket_id" {
  value = aws_s3_bucket.bucket.id
}

output "bucket_arn" {
  value = aws_s3_bucket.bucket.arn
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.cdn.domain_name
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.cdn.id
}

output "lambda_function_url" {
  description = "Dashboard API Proxy Lambda Function URL"
  value       = aws_lambda_function_url.api_proxy_url.function_url
}

output "github_actions_role_arn" {
  description = "GitHub Actions OIDC 배포를 위한 IAM 역할 ARN"
  value       = aws_iam_role.github_actions_role.arn
}
