# ==============================================================================
# 인증 (Cognito App Client)
# ==============================================================================

# Won-Secret 프론트엔드용 Cognito App Client
resource "aws_cognito_user_pool_client" "client" {
  name         = "${var.project_name}-secret-client-${var.environment}"
  user_pool_id = var.cognito_user_pool_id

  # SPA용 설정 (Client Secret 미사용)
  generate_secret = false

  # ALLOW_USER_SRP_AUTH: 비밀번호를 네트워크로 전송하지 않는 SRP 방식 (권장)
  # Amplify v6 Authenticator 컴포넌트는 기본적으로 SRP를 사용하므로
  # ALLOW_USER_PASSWORD_AUTH (평문 전송) 는 필요하지 않음
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # 계정 존재 여부를 응답에서 숨겨 사용자 열거 공격 방지
  prevent_user_existence_errors = "ENABLED"
}
