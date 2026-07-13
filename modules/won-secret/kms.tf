# ==============================================================================
# KMS 키 (민감 필드 암호화용)
# ==============================================================================

resource "aws_kms_key" "field_encryption" {
  description             = "Won-Secret 필드 단위 암호화 키"
  deletion_window_in_days = 14
  enable_key_rotation     = true
  key_usage               = "ENCRYPT_DECRYPT"
  policy                  = data.aws_iam_policy_document.kms_policy.json

  tags = {
    Name = "${var.project_name}-secret-field-key-${var.environment}"
  }
}

data "aws_iam_policy_document" "kms_policy" {
  statement {
    sid       = "Enable IAM User Permissions"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  statement {
    sid    = "Allow Lambda to use the key"
    effect = "Allow"
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey"
    ]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.lambda_role.arn]
    }
  }
}

resource "aws_kms_alias" "field_encryption" {
  name          = "alias/${var.project_name}-secret-field-${var.environment}"
  target_key_id = aws_kms_key.field_encryption.key_id
}
