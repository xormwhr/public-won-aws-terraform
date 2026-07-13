# ==============================================================================
# DynamoDB 모듈 - Single Table Design
# ==============================================================================
# 
# [Single Table Design이란?]
# - 전통적 RDBMS는 엔티티별로 테이블을 분리 (posts, comments, users)
# - DynamoDB에서는 하나의 테이블에 모든 엔티티를 저장
# - PK/SK 조합으로 엔티티 유형과 관계를 표현
#
# [왜 Single Table Design을 사용하는가?]
# 1. 비용 절감: 테이블 1개 = 관리 포인트 1개
# 2. 성능 최적화: 연관 데이터를 한 번의 Query로 조회 (예: 포스트 + 댓글)
# 3. 트랜잭션 단순화: 같은 테이블 내 아이템은 트랜잭션 처리 용이
#
# [키 설계 원칙]
# - PK (Partition Key): 데이터 분산의 기준 (예: POST#<id>, USER#<id>)
# - SK (Sort Key): 파티션 내 정렬 및 관계 표현 (예: COMMENT#<date>)
# - GSI: 다른 접근 패턴 지원 (예: 전체 포스트 목록 조회)
# ==============================================================================

# ------------------------------------------------------------------------------
# DynamoDB 테이블 생성
# ------------------------------------------------------------------------------
resource "aws_dynamodb_table" "main" {
  name         = "${var.project_name}-${var.environment}-table"
  billing_mode = "PAY_PER_REQUEST" # On-Demand 모드 (프리티어 포함)

  # [PAY_PER_REQUEST vs PROVISIONED]
  # - PAY_PER_REQUEST: 사용한 만큼만 과금, 트래픽 예측 불필요
  # - PROVISIONED: 미리 용량 예약, 비용 예측 가능하지만 초과 시 스로틀링
  # → 블로그는 트래픽 변동이 크므로 On-Demand가 적합

  # Primary Key 정의
  hash_key  = "PK" # Partition Key
  range_key = "SK" # Sort Key

  # 속성 정의 (키로 사용되는 속성만 여기에 선언)
  attribute {
    name = "PK"
    type = "S" # String
  }

  attribute {
    name = "SK"
    type = "S"
  }

  # GSI1: 전체 포스트 목록 조회용
  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  # ------------------------------------------------------------------------------
  # Global Secondary Index 1
  # ------------------------------------------------------------------------------
  # [용도] 모든 포스트를 최신순으로 조회
  # [접근 패턴] GSI1PK = "POSTS", GSI1SK = CreatedAt (역순 정렬)
  # ------------------------------------------------------------------------------
  global_secondary_index {
    name            = "GSI1"
    projection_type = "ALL" # 모든 속성 복제

    # AWS Provider v6.x 호환을 위한 GSI 키 스키마 정의 (경고 방지)
    # GSI1PK를 해시(Partition) 키로 구성합니다.
    key_schema {
      attribute_name = "GSI1PK"
      key_type       = "HASH"
    }

    # GSI1SK를 범위(Sort) 키로 구성합니다.
    key_schema {
      attribute_name = "GSI1SK"
      key_type       = "RANGE"
    }

    # [projection_type 옵션]
    # - ALL: 모든 속성 (읽기 편의, 스토리지 비용 증가)
    # - KEYS_ONLY: 키만 (스토리지 절약, 추가 조회 필요)
    # - INCLUDE: 지정한 속성만
  }

  # Point-in-time Recovery (선택적)
  # 프리티어에서는 비용 발생하므로 비활성화
  point_in_time_recovery {
    enabled = false
  }

  # TTL 설정 (IP 해시 데이터 자동 삭제용)
  # VISITOR_IP# 및 POST_VIEW# 아이템에 ttl 속성을 설정하여
  # 90일 후 자동 삭제합니다. (개인정보 보호 강화)
  ttl {
    enabled        = true
    attribute_name = "ttl"
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-table"
    Environment = var.environment
    Design      = "SingleTable"
  }
}
