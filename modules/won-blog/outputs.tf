# ==============================================================================
# Won-Blog 모듈 - 출력값
# ==============================================================================
# 각 리소스 생성 시 출력값을 추가합니다.

output "dynamodb_table_name" {
  description = "DynamoDB 테이블 이름"
  value       = aws_dynamodb_table.main.name
}

output "dynamodb_table_arn" {
  description = "DynamoDB 테이블 ARN"
  value       = aws_dynamodb_table.main.arn
}

output "images_bucket_name" {
  description = "S3 이미지 버킷 이름"
  value       = aws_s3_bucket.images.bucket
}

output "images_bucket_arn" {
  description = "S3 이미지 버킷 ARN"
  value       = aws_s3_bucket.images.arn
}

output "images_cloudfront_domain" {
  description = "이미지 CloudFront CDN 도메인"
  value       = aws_cloudfront_distribution.images.domain_name
}

output "appsync_graphql_url" {
  description = "AppSync GraphQL 엔드포인트 URL"
  value       = aws_appsync_graphql_api.main.uris["GRAPHQL"]
}

output "appsync_api_key" {
  description = "AppSync API Key (비인증 읽기용)"
  value       = aws_appsync_api_key.main.key
  sensitive   = true
}

output "hosting_s3_bucket" {
  description = "정적 사이트 S3 버킷 이름 (GitHub Actions 배포 대상)"
  value       = aws_s3_bucket.frontend.bucket
}

output "hosting_cloudfront_id" {
  description = "CloudFront 배포 ID (캐시 무효화용)"
  value       = aws_cloudfront_distribution.frontend.id
}

output "hosting_cloudfront_domain" {
  description = "CloudFront 배포 도메인 (접속 URL)"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "identity_pool_id" {
  description = "Cognito Identity Pool ID (S3 업로드용)"
  value       = aws_cognito_identity_pool.main.id
}
