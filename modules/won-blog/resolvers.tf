# ==============================================================================
# AppSync Resolvers - Mutation
# ==============================================================================
#
# [Resolver란?]
# - GraphQL 필드와 데이터 소스를 연결하는 중간 계층
# - Request Template: GraphQL 요청 → 데이터 소스 요청으로 변환
# - Response Template: 데이터 소스 응답 → GraphQL 응답으로 변환
#
# [VTL vs JavaScript Resolver]
# - VTL: 간단한 CRUD에 적합, 콜드스타트 없음
# - JS: 복잡한 로직에 적합 (조건부, 루프 등)
# → 블로그는 단순 CRUD이므로 VTL 선택
# ==============================================================================

# ------------------------------------------------------------------------------
# createPost Resolver
# ------------------------------------------------------------------------------
resource "aws_appsync_resolver" "create_post" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Mutation"
  field       = "createPost"
  data_source = aws_appsync_datasource.dynamodb.name

  request_template  = file("${path.module}/resolvers/Mutation.createPost.req.vtl")
  response_template = file("${path.module}/resolvers/Mutation.createPost.res.vtl")
}

# ------------------------------------------------------------------------------
# updatePost Resolver
# ------------------------------------------------------------------------------
resource "aws_appsync_resolver" "update_post" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Mutation"
  field       = "updatePost"
  data_source = aws_appsync_datasource.dynamodb.name

  request_template  = file("${path.module}/resolvers/Mutation.updatePost.req.vtl")
  response_template = file("${path.module}/resolvers/Mutation.updatePost.res.vtl")
}

resource "aws_appsync_resolver" "delete_post" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Mutation"
  field       = "deletePost"
  data_source = aws_appsync_datasource.post_lambda.name
}

# ------------------------------------------------------------------------------
# createComment Resolver
# ------------------------------------------------------------------------------
resource "aws_appsync_resolver" "create_comment" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Mutation"
  field       = "createComment"
  data_source = aws_appsync_datasource.dynamodb.name

  request_template  = file("${path.module}/resolvers/Mutation.createComment.req.vtl")
  response_template = file("${path.module}/resolvers/Mutation.createComment.res.vtl")
}

# ==============================================================================
# AppSync Resolvers - Query
# ==============================================================================

# ------------------------------------------------------------------------------
# getPost Resolver
# ------------------------------------------------------------------------------
resource "aws_appsync_resolver" "get_post" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Query"
  field       = "getPost"
  data_source = aws_appsync_datasource.dynamodb.name

  request_template  = file("${path.module}/resolvers/Query.getPost.req.vtl")
  response_template = file("${path.module}/resolvers/Query.getPost.res.vtl")
}

# ------------------------------------------------------------------------------
# listPosts Resolver
# ------------------------------------------------------------------------------
resource "aws_appsync_resolver" "list_posts" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Query"
  field       = "listPosts"
  data_source = aws_appsync_datasource.dynamodb.name

  request_template  = file("${path.module}/resolvers/Query.listPosts.req.vtl")
  response_template = file("${path.module}/resolvers/Query.listPosts.res.vtl")
}

# ------------------------------------------------------------------------------
# listAllPosts Resolver (인증된 사용자 전용 - 초안 포함 전체 조회)
# ------------------------------------------------------------------------------
resource "aws_appsync_resolver" "list_all_posts" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Query"
  field       = "listAllPosts"
  data_source = aws_appsync_datasource.dynamodb.name

  request_template  = file("${path.module}/resolvers/Query.listAllPosts.req.vtl")
  response_template = file("${path.module}/resolvers/Query.listAllPosts.res.vtl")
}

# ------------------------------------------------------------------------------
# listTags Resolver
# ------------------------------------------------------------------------------
resource "aws_appsync_resolver" "list_tags" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Query"
  field       = "listTags"
  data_source = aws_appsync_datasource.dynamodb.name

  request_template  = file("${path.module}/resolvers/Query.listTags.req.vtl")
  response_template = file("${path.module}/resolvers/Query.listTags.res.vtl")
}

# ------------------------------------------------------------------------------
# createTag Resolver
# ------------------------------------------------------------------------------
resource "aws_appsync_resolver" "create_tag" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Mutation"
  field       = "createTag"
  data_source = aws_appsync_datasource.dynamodb.name

  request_template  = file("${path.module}/resolvers/Mutation.createTag.req.vtl")
  response_template = file("${path.module}/resolvers/Mutation.createTag.res.vtl")
}

# ------------------------------------------------------------------------------
# deleteTag Resolver
# ------------------------------------------------------------------------------
resource "aws_appsync_resolver" "delete_tag" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Mutation"
  field       = "deleteTag"
  data_source = aws_appsync_datasource.dynamodb.name

  request_template  = file("${path.module}/resolvers/Mutation.deleteTag.req.vtl")
  response_template = file("${path.module}/resolvers/Mutation.deleteTag.res.vtl")
}

# ==============================================================================
# Visitor & View Count Resolvers (Lambda - IP 기반 중복 방지)
# ==============================================================================
# 기존 VTL Pipeline Resolver를 Lambda Direct Resolver로 교체
# IP SHA-256 해싱 + DynamoDB 조건부 쓰기로 중복 방문/조회 방지
# ==============================================================================

# ------------------------------------------------------------------------------
# getVisitorStats Resolver (기존 VTL 유지 - 조회만 하므로 IP 불필요)
# ------------------------------------------------------------------------------
resource "aws_appsync_resolver" "get_visitor_stats" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Query"
  field       = "getVisitorStats"
  data_source = aws_appsync_datasource.dynamodb.name

  request_template  = file("${path.module}/resolvers/Query.getVisitorStats.req.vtl")
  response_template = file("${path.module}/resolvers/Query.getVisitorStats.res.vtl")
}

# ------------------------------------------------------------------------------
# recordVisit Resolver (Lambda - IP 기반 중복 방지)
# ------------------------------------------------------------------------------
# 기존 Pipeline Resolver(recordDailyVisit + recordTotalVisit)를
# Lambda Direct Resolver로 교체하여 IP 해싱 기반 중복 방지 구현
# ------------------------------------------------------------------------------
resource "aws_appsync_resolver" "record_visit" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Mutation"
  field       = "recordVisit"
  data_source = aws_appsync_datasource.visitor_lambda.name
}

# ------------------------------------------------------------------------------
# recordPostView Resolver (Lambda - IP 기반 중복 방지)
# ------------------------------------------------------------------------------
resource "aws_appsync_resolver" "record_post_view" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Mutation"
  field       = "recordPostView"
  data_source = aws_appsync_datasource.visitor_lambda.name
}

# ==============================================================================
# Comment Resolvers (댓글 기능)
# ==============================================================================

# ------------------------------------------------------------------------------
# listComments Resolver - 특정 포스트의 댓글 목록 조회 (비인증 허용)
# DynamoDB: PK=POST#postId, SK begins_with COMMENT# (시간순)
# ------------------------------------------------------------------------------
resource "aws_appsync_resolver" "list_comments" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Query"
  field       = "listComments"
  data_source = aws_appsync_datasource.dynamodb.name

  request_template  = file("${path.module}/resolvers/Query.listComments.req.vtl")
  response_template = file("${path.module}/resolvers/Query.listComments.res.vtl")
}

# ------------------------------------------------------------------------------
# deleteComment Resolver - 인증된 사용자 전용 댓글 삭제
# PK=POST#postId, SK=COMMENT#createdAt#commentId 로 직접 삭제 (O(1))
# ------------------------------------------------------------------------------
resource "aws_appsync_resolver" "delete_comment" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Mutation"
  field       = "deleteComment"
  data_source = aws_appsync_datasource.dynamodb.name

  request_template  = file("${path.module}/resolvers/Mutation.deleteComment.req.vtl")
  response_template = file("${path.module}/resolvers/Mutation.deleteComment.res.vtl")
}
