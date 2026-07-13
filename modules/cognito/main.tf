# ==============================================================================
# Cognito User Pool 및 Client 정의
# ==============================================================================

resource "aws_cognito_user_pool" "pool" {
  name = var.user_pool_name

  # 이메일 기반 로그인 설정
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # 비밀번호 정책
  password_policy {
    minimum_length    = 8
    require_lowercase = false
    require_uppercase = false
    require_numbers   = true
    require_symbols   = true
  }

  # 관리자만 사용자 생성 가능 (보안 정책)
  # - allow_admin_create_user_only = true 로 설정 시:
  #     · 외부에서 SignUp API를 직접 호출해도 NotAuthorizedException 반환
  #     · AWS Console/CLI/SDK 를 통한 관리자 계정 생성만 허용
  #     · 프론트엔드 hideSignUp={true} 와 인프라 레벨 이중 차단
  # - 새 사용자 추가 방법 (AWS CLI):
  #     aws cognito-idp admin-create-user \
  #       --user-pool-id <USER_POOL_ID> \
  #       --username user@example.com \
  #       --temporary-password "<YOUR_TEMPORARY_PASSWORD>" \
  #       --region ap-northeast-2
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  # 계정 복구 설정
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  tags = {
    Name        = var.user_pool_name
    Environment = var.environment
  }
}

# 앱 클라이언트 생성 (Client Secret 미사용 - SPA용)
resource "aws_cognito_user_pool_client" "client" {
  name         = "${var.project_name}-${var.environment}-client"
  user_pool_id = aws_cognito_user_pool.pool.id

  generate_secret = false

  # ALLOW_USER_SRP_AUTH: 비밀번호를 네트워크로 전송하지 않는 SRP 방식 (권장)
  # ALLOW_USER_PASSWORD_AUTH 는 비밀번호 평문 전송 방식이므로 사용하지 않음
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # 계정 존재 여부를 응답에서 숨겨 사용자 열거 공격 방지
  prevent_user_existence_errors = "ENABLED"

  # 토큰 만료 시간 설정 (기본값: Refresh 24h, Access/Id 60m)
  refresh_token_validity = var.refresh_token_validity
  access_token_validity  = var.access_token_validity
  id_token_validity      = var.id_token_validity

  token_validity_units {
    refresh_token = var.token_validity_units.refresh_token
    access_token  = var.token_validity_units.access_token
    id_token      = var.token_validity_units.id_token
  }
}

# ------------------------------------------------------------------------------
# 출력값 정의용 로컬 파일
# ------------------------------------------------------------------------------
output "user_pool_id" {
  value = aws_cognito_user_pool.pool.id
}

output "user_pool_client_id" {
  value = aws_cognito_user_pool_client.client.id
}

output "user_pool_arn" {
  description = "Cognito User Pool ARN (API Gateway Authorizer 연동용)"
  value       = aws_cognito_user_pool.pool.arn
}

# ArgoCD OIDC 인증용 Cognito App Client
# - OAuth Authorization Code Flow ("code") 방식을 사용합니다.
# - client_secret 생성을 활성화합니다.
# - callback_urls에 ArgoCD Ingress의 인증 콜백 주소를 주입합니다.
resource "aws_cognito_user_pool_client" "argocd" {
  name         = "${var.project_name}-argocd-client-${var.environment}"
  user_pool_id = aws_cognito_user_pool.pool.id

  generate_secret = true

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  allowed_oauth_flows_user_pool_client = true
  supported_identity_providers         = ["COGNITO"]

  callback_urls = ["https://argocd.example.com/auth/callback"]
  logout_urls   = ["https://argocd.example.com"]

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

# Grafana OIDC 인증용 Cognito App Client
# - OAuth Authorization Code Flow ("code") 방식을 사용합니다.
# - client_secret 생성을 활성화합니다.
# - callback_urls에 Grafana Ingress의 generic oauth 콜백 주소를 주입합니다.
resource "aws_cognito_user_pool_client" "grafana" {
  name         = "${var.project_name}-grafana-client-${var.environment}"
  user_pool_id = aws_cognito_user_pool.pool.id

  generate_secret = true

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  allowed_oauth_flows_user_pool_client = true
  supported_identity_providers         = ["COGNITO"]

  callback_urls = ["https://grafana.example.com/login/generic_oauth"]
  logout_urls   = ["https://grafana.example.com"]

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

# Cognito User Pool에 admin 그룹 추가
# - 이 그룹에 속한 사용자는 ArgoCD와 Grafana 로그인 시 Admin 권한을 부여받게 됩니다.
resource "aws_cognito_user_group" "admin" {
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.pool.id
  description  = "Admin group for ArgoCD and Grafana"
}

output "argocd_cognito_client_id" {
  value = aws_cognito_user_pool_client.argocd.id
}

output "argocd_cognito_client_secret" {
  value     = aws_cognito_user_pool_client.argocd.client_secret
  sensitive = true
}

output "grafana_cognito_client_id" {
  value = aws_cognito_user_pool_client.grafana.id
}

output "grafana_cognito_client_secret" {
  value     = aws_cognito_user_pool_client.grafana.client_secret
  sensitive = true
}
