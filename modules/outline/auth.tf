# ==============================================================================
# Outline OIDC 인증용 Cognito App Client
# ==============================================================================

resource "aws_cognito_user_pool_client" "outline" {
  name         = "${var.project_name}-outline-client-${var.environment}"
  user_pool_id = var.cognito_user_pool_id

  generate_secret = true

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  allowed_oauth_flows_user_pool_client = true
  supported_identity_providers         = ["COGNITO"]

  callback_urls = ["https://${var.outline_domain}/auth/oidc.callback"]
  logout_urls   = ["https://${var.outline_domain}"]

  prevent_user_existence_errors = "ENABLED"

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 24

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "hours"
  }
}
