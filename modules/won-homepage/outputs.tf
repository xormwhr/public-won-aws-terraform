# ==============================================================================
# 파일명: outputs.tf
# 경로: modules/won-homepage/outputs.tf
# 설명: won-homepage 호스팅 모듈이 외부로 제공할 출력값 선언
# ==============================================================================

output "bucket_id" {
  description = "정적 포트폴리오 파일 배포를 위해 생성된 S3 버킷의 고유 ID"
  value       = aws_s3_bucket.bucket.id
}

output "cloudfront_domain" {
  description = "생성된 CloudFront CDN 배포 웹사이트 도메인 주소"
  value       = aws_cloudfront_distribution.cdn.domain_name
}

output "github_actions_role_arn" {
  description = "GitHub Actions OIDC 배포를 위해 생성된 IAM 역할(Role) ARN"
  value       = aws_iam_role.github_actions_role.arn
}
