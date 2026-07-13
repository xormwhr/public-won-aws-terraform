# ==============================================================================
# Cognito User Pool Domain (OAuth 2.0 엔드포인트용)
# ==============================================================================

resource "aws_cognito_user_pool_domain" "main" {
  domain       = var.cognito_domain_prefix
  user_pool_id = var.cognito_user_pool_id
}
