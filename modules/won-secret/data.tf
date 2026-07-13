# ==============================================================================
# 모듈 공통 데이터 소스
# ==============================================================================

# Route53 호스팅 영역 정보 조회
data "aws_route53_zone" "selected" {
  name         = var.root_domain
  private_zone = false
}

# 현재 AWS 계정 정보 조회
data "aws_caller_identity" "current" {}

# 현재 AWS 리전 정보 조회
data "aws_region" "current" {}
