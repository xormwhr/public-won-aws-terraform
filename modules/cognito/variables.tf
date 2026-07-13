# ==============================================================================
# Cognito 모듈 변수
# ==============================================================================

variable "user_pool_name" {
  description = "Cognito User Pool 이름"
  type        = string
  default     = "won-user-pool"
}

variable "project_name" {
  description = "프로젝트 이름"
  type        = string
}

variable "environment" {
  description = "배포 환경"
  type        = string
}

variable "refresh_token_validity" {
  description = "Refresh Token 유효 기간 (단위: token_validity_units 참고)"
  type        = number
  default     = 24 # 기본 24시간
}

variable "access_token_validity" {
  description = "Access Token 유효 기간 (단위: token_validity_units 참고)"
  type        = number
  default     = 60 # 기본 60분
}

variable "id_token_validity" {
  description = "Id Token 유효 기간 (단위: token_validity_units 참고)"
  type        = number
  default     = 60 # 기본 60분
}

variable "token_validity_units" {
  description = "토큰 유효 기간 단위 설정"
  type = object({
    refresh_token = string
    access_token  = string
    id_token      = string
  })
  default = {
    refresh_token = "hours"
    access_token  = "minutes"
    id_token      = "minutes"
  }
}
