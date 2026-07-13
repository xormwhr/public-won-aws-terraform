# ==============================================================================
# Dashboard Bookmarks DynamoDB Table
# ==============================================================================

resource "aws_dynamodb_table" "bookmarks" {
  name         = "${var.project_name}-bookmarks-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  tags = {
    Name        = "${var.project_name}-bookmarks-${var.environment}"
    Environment = var.environment
    Project     = var.project_name
  }
}
