# ==============================================================================
# 프로바이더 요구사항 선언 (Provider Alias 지원)
# ==============================================================================

terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.useast1]
    }
  }
}
