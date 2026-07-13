// ==============================================================================
// Won-Secret Lambda 핸들러
// 단일 함수에서 REST API CRUD를 처리한다.
// ==============================================================================

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { KMSClient, EncryptCommand, DecryptCommand } from "@aws-sdk/client-kms";
import { randomUUID } from "node:crypto";

const TABLE_NAME = process.env.TABLE_NAME;
const KMS_KEY_ID = process.env.KMS_KEY_ID;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const kmsClient = new KMSClient({});

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
};

// --- 유틸리티 ---

/**
 * KMS를 사용하여 평문을 암호화하고 Base64 문자열로 반환한다.
 */
async function encryptField(plaintext) {
  if (!plaintext) return null;
  const command = new EncryptCommand({
    KeyId: KMS_KEY_ID,
    Plaintext: new TextEncoder().encode(plaintext),
  });
  const response = await kmsClient.send(command);
  return Buffer.from(response.CiphertextBlob).toString("base64");
}

/**
 * KMS를 사용하여 암호문을 복호화하고 평문 문자열로 반환한다.
 */
async function decryptField(ciphertext) {
  if (!ciphertext) return null;
  const command = new DecryptCommand({
    CiphertextBlob: Buffer.from(ciphertext, "base64"),
  });
  const response = await kmsClient.send(command);
  return new TextDecoder().decode(response.Plaintext);
}

/**
 * API Gateway 응답 형식을 생성한다.
 */
function response(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...corsHeaders },
    body: JSON.stringify(body),
  };
}

/**
 * Cognito Authorizer를 통해 전달된 User ID를 추출한다.
 */
function getUserId(event) {
  return event.requestContext.authorizer.claims.sub;
}

// --- 보안 유틸리티 ---

/**
 * [보안 검증] 입력값 길이 및 형식 검증 헬퍼
 */
function validateInput(body) {
  if (body.name && body.name.length > 100) return "이름은 100자를 초과할 수 없습니다.";
  if (body.category && body.category.length > 50) return "카테고리는 50자를 초과할 수 없습니다.";
  if (body.url && body.url.length > 2048) return "URL이 너무 깁니다.";
  if (body.tags && !Array.isArray(body.tags)) return "태그는 배열 형식이어야 합니다.";
  
  if (body.secretValue && Buffer.byteLength(body.secretValue, 'utf8') > 10240) {
    return "시크릿 데이터가 허용된 크기(10KB)를 초과했습니다.";
  }
  return null;
}

// --- CRUD 핸들러 ---

/**
 * 사용자의 시크릿 목록을 조회한다.
 */
async function listSecrets(event) {
  const userId = getUserId(event);
  const category = event.queryStringParameters?.category;

  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: category
      ? "PK = :pk AND begins_with(SK, :sk)"
      : "PK = :pk AND begins_with(SK, :skPrefix)",
    ExpressionAttributeValues: category
      ? { ":pk": `USER#${userId}`, ":sk": `ITEM#${category}#` }
      : { ":pk": `USER#${userId}`, ":skPrefix": "ITEM#" },
  };

  const result = await docClient.send(new QueryCommand(params));
  // 목록 조회 시에는 암호화된 필드는 제외하거나 그대로 반환 (상세조회에서 복호화)
  const items = (result.Items || []).map(
    ({ secretValue, memo, PK, SK, ...rest }) => rest
  );

  return response(200, { success: true, data: items, count: items.length });
}

/**
 * 특정 시크릿 항목을 조회하고 암호화된 필드를 복호화한다.
 */
async function getSecret(event) {
  const userId = getUserId(event);
  const itemId = event.pathParameters.itemId;

  // Single Table Design에서 itemId로 직접 조회하기 위해 FilterExpression 사용
  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
    FilterExpression: "itemId = :itemId",
    ExpressionAttributeValues: {
      ":pk": `USER#${userId}`,
      ":skPrefix": "ITEM#",
      ":itemId": itemId,
    },
  };

  const result = await docClient.send(new QueryCommand(params));

  if (!result.Items || result.Items.length === 0) {
    return response(404, {
      success: false,
      error: { code: "NOT_FOUND", message: "항목을 찾을 수 없습니다" },
    });
  }

  const item = result.Items[0];
  const { PK, SK, ...cleanItem } = item;
  cleanItem.secretValue = await decryptField(item.secretValue);
  cleanItem.memo = await decryptField(item.memo);

  return response(200, { success: true, data: cleanItem });
}

/**
 * 새로운 시크릿 항목을 생성하고 필드를 암호화한다.
 */
async function createSecret(event) {
  const userId = getUserId(event);
  const body = JSON.parse(event.body);

  if (!body.name || !body.category || !body.secretValue) {
    return response(400, {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "name, category, secretValue는 필수입니다",
      },
    });
  }

  const validationError = validateInput(body);
  if (validationError) {
    return response(400, {
      success: false,
      error: { code: "VALIDATION_ERROR", message: validationError },
    });
  }

  const itemId = randomUUID();
  const now = new Date().toISOString();

  const encryptedValue = await encryptField(body.secretValue);
  const encryptedMemo = await encryptField(body.memo || null);

  const item = {
    PK: `USER#${userId}`,
    SK: `ITEM#${body.category}#${itemId}`,
    itemId,
    name: body.name,
    category: body.category,
    secretValue: encryptedValue,
    tags: body.tags || [],
    createdAt: now,
    updatedAt: now,
  };

  if (encryptedMemo) item.memo = encryptedMemo;
  if (body.url) item.url = body.url;
  if (body.expiresAt) item.expiresAt = body.expiresAt;

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  const { PK, SK, secretValue, memo, ...responseItem } = item;
  return response(201, { success: true, data: responseItem });
}

/**
 * 시크릿 항목을 수정한다. 카테고리가 변경되면 SK를 업데이트(삭제 후 재생성)한다.
 */
async function updateSecret(event) {
  const userId = getUserId(event);
  const itemId = event.pathParameters.itemId;
  const body = JSON.parse(event.body);

  const validationError = validateInput(body);
  if (validationError) {
    return response(400, {
      success: false,
      error: { code: "VALIDATION_ERROR", message: validationError },
    });
  }

  const queryParams = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
    FilterExpression: "itemId = :itemId",
    ExpressionAttributeValues: {
      ":pk": `USER#${userId}`,
      ":skPrefix": "ITEM#",
      ":itemId": itemId,
    },
  };

  const queryResult = await docClient.send(new QueryCommand(queryParams));

  if (!queryResult.Items || queryResult.Items.length === 0) {
    return response(404, {
      success: false,
      error: { code: "NOT_FOUND", message: "항목을 찾을 수 없습니다" },
    });
  }

  const existing = queryResult.Items[0];
  const now = new Date().toISOString();

  const newCategory = body.category || existing.category;
  const categoryChanged = body.category && body.category !== existing.category;

  // 한글 설명 주석: body에 secretValue와 memo 값이 주어지지 않은 경우 기존 값을 유지하고, 있으면 암호화하여 대입합니다.
  const encryptedValue =
    body.secretValue === undefined
      ? existing.secretValue
      : await encryptField(body.secretValue);
  const encryptedMemo =
    body.memo === undefined ? existing.memo : await encryptField(body.memo);

  // 한글 설명 주석: url, tags, expiresAt 필드 역시 제공되지 않았다면 기존 값을 유지하고, 제공되었다면 해당 값을 사용하여 업데이트할 항목 객체를 구성합니다.
  const updatedItem = {
    PK: existing.PK,
    SK: categoryChanged ? `ITEM#${newCategory}#${itemId}` : existing.SK,
    itemId,
    name: body.name || existing.name,
    category: newCategory,
    secretValue: encryptedValue,
    memo: encryptedMemo,
    url: body.url === undefined ? existing.url : body.url,
    tags: body.tags === undefined ? existing.tags : body.tags,
    expiresAt: body.expiresAt === undefined ? existing.expiresAt : body.expiresAt,
    createdAt: existing.createdAt,
    updatedAt: now,
  };

  // DynamoDB GSI 제약사항 때문에 null 값을 삭제 처리해야 함
  if (updatedItem.expiresAt === null) {
    delete updatedItem.expiresAt;
  }
  if (updatedItem.url === null) {
    delete updatedItem.url;
  }
  if (updatedItem.memo === null) {
    delete updatedItem.memo;
  }

  // 카테고리가 변경되어 SK가 달라진 경우 기존 항목 삭제
  if (categoryChanged) {
    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: existing.PK, SK: existing.SK },
      })
    );
  }

  await docClient.send(
    new PutCommand({ TableName: TABLE_NAME, Item: updatedItem })
  );

  const { PK, SK, secretValue, memo, ...responseItem } = updatedItem;
  return response(200, { success: true, data: responseItem });
}

/**
 * 시크릿 항목을 삭제한다.
 */
async function deleteSecret(event) {
  const userId = getUserId(event);
  const itemId = event.pathParameters.itemId;

  const queryParams = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
    FilterExpression: "itemId = :itemId",
    ExpressionAttributeValues: {
      ":pk": `USER#${userId}`,
      ":skPrefix": "ITEM#",
      ":itemId": itemId,
    },
  };

  const queryResult = await docClient.send(new QueryCommand(queryParams));

  if (!queryResult.Items || queryResult.Items.length === 0) {
    return response(404, {
      success: false,
      error: { code: "NOT_FOUND", message: "항목을 찾을 수 없습니다" },
    });
  }

  const item = queryResult.Items[0];
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: item.PK, SK: item.SK },
    })
  );

  return response(200, { success: true, data: { itemId, deleted: true } });
}

/**
 * 사용자가 보유한 카테고리 목록을 중복 없이 반환한다.
 */
async function listCategories(event) {
  const userId = getUserId(event);

  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
    ProjectionExpression: "category",
    ExpressionAttributeValues: {
      ":pk": `USER#${userId}`,
      ":skPrefix": "ITEM#",
    },
  };

  const result = await docClient.send(new QueryCommand(params));
  const categories = [...new Set((result.Items || []).map((i) => i.category))];

  return response(200, { success: true, data: categories });
}

// --- 메인 라우터 ---

function handleLambdaError(error) {
  // Error 객체는 JSON.stringify 시 빈 객체 {}로 직렬화되므로 명시적으로 프로퍼티를 추출
  console.error("Lambda 오류:", {
    name: error.name,
    message: error.message,
    code: error.code,
    statusCode: error.$metadata?.httpStatusCode,
    stack: error.stack,
  });

  // AWS SDK v3 KMS 오류 이름은 접두사 없이 단순 클래스명으로 전달됨
  const KMS_ERRORS = new Set([
    "AccessDeniedException",       // KMS 키 접근 거부
    "InvalidStateException",       // KMS 키 비활성화/삭제 상태
    "DisabledException",           // KMS 키 비활성화
    "InvalidKeyUsageException",    // 키 용도 불일치
    "KMSInternalException",        // KMS 내부 오류
    "NotFoundException",           // KMS 키 미존재
  ]);

  // DynamoDB 오류
  const DDB_ERRORS = new Set([
    "ValidationException",         // 잘못된 타입/구조로 PutItem 시도
    "ResourceNotFoundException",   // 테이블 미존재
    "ProvisionedThroughputExceededException",
    "ConditionalCheckFailedException",
  ]);

  if (KMS_ERRORS.has(error.name)) {
    return response(500, {
      success: false,
      error: { code: "ENCRYPTION_ERROR", message: "암호화 처리 중 오류가 발생했습니다" },
    });
  }

  if (DDB_ERRORS.has(error.name)) {
    return response(500, {
      success: false,
      error: { code: "DATABASE_ERROR", message: "데이터 저장 중 오류가 발생했습니다" },
    });
  }

  return response(500, {
    success: false,
    error: { code: "INTERNAL_ERROR", message: "서버 내부 오류가 발생했습니다" },
  });
}

export const handler = async (event) => {
  // CORS Preflight 처리
  if (event.httpMethod === "OPTIONS") {
    return response(200, {});
  }

  try {
    const method = event.httpMethod;
    const resource = event.resource;

    if (resource === "/secrets" && method === "GET") return await listSecrets(event);
    if (resource === "/secrets/{itemId}" && method === "GET") return await getSecret(event);
    if (resource === "/secrets" && method === "POST") return await createSecret(event);
    if (resource === "/secrets/{itemId}" && method === "PUT") return await updateSecret(event);
    if (resource === "/secrets/{itemId}" && method === "DELETE") return await deleteSecret(event);
    if (resource === "/categories" && method === "GET") return await listCategories(event);

    return response(404, {
      success: false,
      error: { code: "NOT_FOUND", message: "지원하지 않는 경로입니다" },
    });
  } catch (error) {
    return handleLambdaError(error);
  }
};
