# ==============================================================================
# DynamoDB 테이블 (민감정보 저장)
# ==============================================================================

resource "aws_dynamodb_table" "secrets" {
  name         = "${var.project_name}-secret-items-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "expiresAt"
    type = "S"
  }

  global_secondary_index {
    name            = "ExpiryIndex"
    projection_type = "ALL"

    # AWS Provider v6.x 호환을 위한 GSI 키 스키마 정의 (경고 방지)
    # PK를 해시(Partition) 키로 구성합니다.
    key_schema {
      attribute_name = "PK"
      key_type       = "HASH"
    }

    # expiresAt 속성을 범위(Sort) 키로 구성합니다.
    key_schema {
      attribute_name = "expiresAt"
      key_type       = "RANGE"
    }
  }

  server_side_encryption {
    enabled = true
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name = "${var.project_name}-secret-items-${var.environment}"
  }
}
