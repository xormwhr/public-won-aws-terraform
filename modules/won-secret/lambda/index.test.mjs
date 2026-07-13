// ==============================================================================
// modules/won-secret/lambda/index.test.mjs
// won-secret Lambda 핸들러 단위 테스트
// vi.resetModules() + 동적 import를 사용하여 모듈 레벨 초기화 문제 해결
// ==============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==============================================================================
// 모킹 팩토리 함수
// ==============================================================================

/**
 * DynamoDB Document Client 모킹을 설정하고 handler를 동적으로 임포트합니다.
 * 모듈 레벨에서 클라이언트가 초기화되므로, 각 테스트마다 모듈을 재로드해야 합니다.
 */
async function setupHandler(ddbSendMock, kmsSendMock = vi.fn()) {
  vi.resetModules();

  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn().mockImplementation(() => ({ send: ddbSendMock })),
  }));

  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: {
      from: vi.fn().mockImplementation(() => ({ send: ddbSendMock })),
    },
    PutCommand: vi.fn().mockImplementation((input) => ({ __type: 'PutCommand', ...input })),
    QueryCommand: vi.fn().mockImplementation((input) => ({ __type: 'QueryCommand', ...input })),
    DeleteCommand: vi.fn().mockImplementation((input) => ({ __type: 'DeleteCommand', ...input })),
  }));

  vi.doMock('@aws-sdk/client-kms', () => ({
    KMSClient: vi.fn().mockImplementation(() => ({ send: kmsSendMock })),
    EncryptCommand: vi.fn().mockImplementation((input) => ({ __type: 'EncryptCommand', ...input })),
    DecryptCommand: vi.fn().mockImplementation((input) => ({ __type: 'DecryptCommand', ...input })),
  }));

  const { handler } = await import('./index.mjs');
  return handler;
}

// ==============================================================================
// 헬퍼 함수
// ==============================================================================

function makeEvent(override = {}) {
  return {
    httpMethod: 'GET',
    resource: '/secrets',
    pathParameters: {},
    queryStringParameters: null,
    headers: {},
    body: null,
    requestContext: {
      authorizer: {
        claims: { sub: 'test-user-uuid-1234' },
      },
    },
    ...override,
  };
}

function makeQueryResult(items = []) {
  return { Items: items };
}

function makeSecretItem(overrides = {}) {
  return {
    PK: 'USER#test-user-uuid-1234',
    SK: 'ITEM#login#item-uuid-5678',
    itemId: 'item-uuid-5678',
    name: 'Test Secret',
    category: 'login',
    secretValue: 'ENCRYPTED_BASE64_VALUE',
    tags: ['work'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ==============================================================================
// 환경변수 설정
// ==============================================================================

beforeEach(() => {
  process.env.TABLE_NAME = 'won-secret-table';
  process.env.KMS_KEY_ID = 'test-kms-key-id';
  process.env.ALLOWED_ORIGIN = 'https://secret.example.com';
});

afterEach(() => {
  delete process.env.TABLE_NAME;
  delete process.env.KMS_KEY_ID;
  delete process.env.ALLOWED_ORIGIN;
  vi.resetModules();
});

// ==============================================================================
// OPTIONS preflight 처리
// ==============================================================================

describe('handler - OPTIONS preflight 처리', () => {
  it('OPTIONS 메서드 요청 시 200 응답을 반환해야 한다', async () => {
    const handler = await setupHandler(vi.fn());
    const event = makeEvent({ httpMethod: 'OPTIONS' });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
  });
});

// ==============================================================================
// 라우팅 - 지원하지 않는 경로
// ==============================================================================

describe('handler - 라우팅', () => {
  it('지원하지 않는 경로 요청 시 404를 반환해야 한다', async () => {
    const handler = await setupHandler(vi.fn());
    const event = makeEvent({ resource: '/unknown', httpMethod: 'GET' });
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ==============================================================================
// listSecrets - GET /secrets
// ==============================================================================

describe('handler - GET /secrets (목록 조회)', () => {
  it('category 없으면 모든 시크릿 목록을 반환해야 한다', async () => {
    const mockSend = vi.fn().mockResolvedValue(makeQueryResult([makeSecretItem()]));
    const handler = await setupHandler(mockSend);

    const event = makeEvent({ resource: '/secrets', httpMethod: 'GET' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
    // 민감한 필드가 제외되어야 함
    expect(body.data[0].secretValue).toBeUndefined();
    expect(body.data[0].PK).toBeUndefined();
    expect(body.data[0].SK).toBeUndefined();
  });

  it('category 있으면 카테고리 필터링된 목록을 반환해야 한다', async () => {
    const mockSend = vi.fn().mockResolvedValue(makeQueryResult([]));
    const handler = await setupHandler(mockSend);

    const event = makeEvent({
      resource: '/secrets',
      httpMethod: 'GET',
      queryStringParameters: { category: 'login' },
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.count).toBe(0);
  });
});

// ==============================================================================
// getSecret - GET /secrets/{itemId}
// ==============================================================================

describe('handler - GET /secrets/{itemId} (상세 조회)', () => {
  it('itemId에 해당하는 시크릿을 복호화하여 반환해야 한다', async () => {
    const secretItem = makeSecretItem({ memo: 'ENCRYPTED_MEMO' });
    const mockDocSend = vi.fn().mockResolvedValue(makeQueryResult([secretItem]));

    const mockKmsSend = vi.fn().mockResolvedValue({
      Plaintext: new TextEncoder().encode('decrypted-secret-value'),
    });
    const handler = await setupHandler(mockDocSend, mockKmsSend);

    const event = makeEvent({
      resource: '/secrets/{itemId}',
      httpMethod: 'GET',
      pathParameters: { itemId: 'item-uuid-5678' },
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
    expect(body.data.secretValue).toBe('decrypted-secret-value');
    expect(body.data.PK).toBeUndefined();
  });

  it('존재하지 않는 itemId 요청 시 404를 반환해야 한다', async () => {
    const mockSend = vi.fn().mockResolvedValue(makeQueryResult([]));
    const handler = await setupHandler(mockSend);

    const event = makeEvent({
      resource: '/secrets/{itemId}',
      httpMethod: 'GET',
      pathParameters: { itemId: 'nonexistent-id' },
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ==============================================================================
// createSecret - POST /secrets
// ==============================================================================

describe('handler - POST /secrets (시크릿 생성)', () => {
  it('필수 필드 없으면 400을 반환해야 한다', async () => {
    const handler = await setupHandler(vi.fn());

    const event = makeEvent({
      resource: '/secrets',
      httpMethod: 'POST',
      body: JSON.stringify({ name: 'Test' }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('name이 100자를 초과하면 400을 반환해야 한다', async () => {
    const handler = await setupHandler(vi.fn());

    const event = makeEvent({
      resource: '/secrets',
      httpMethod: 'POST',
      body: JSON.stringify({
        name: 'A'.repeat(101),
        category: 'test',
        secretValue: 'my-secret',
      }),
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  it('category가 50자를 초과하면 400을 반환해야 한다', async () => {
    const handler = await setupHandler(vi.fn());

    const event = makeEvent({
      resource: '/secrets',
      httpMethod: 'POST',
      body: JSON.stringify({
        name: 'Valid Name',
        category: 'C'.repeat(51),
        secretValue: 'my-secret',
      }),
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  it('tags가 배열이 아니면 400을 반환해야 한다', async () => {
    const handler = await setupHandler(vi.fn());

    const event = makeEvent({
      resource: '/secrets',
      httpMethod: 'POST',
      body: JSON.stringify({
        name: 'Test',
        category: 'login',
        secretValue: 'secret',
        tags: 'not-array',
      }),
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  it('유효한 필드로 시크릿을 생성하고 201을 반환해야 한다', async () => {
    const mockDocSend = vi.fn().mockResolvedValue({});
    const mockKmsSend = vi.fn().mockResolvedValue({
      CiphertextBlob: Buffer.from('encrypted-value'),
    });
    const handler = await setupHandler(mockDocSend, mockKmsSend);

    const event = makeEvent({
      resource: '/secrets',
      httpMethod: 'POST',
      body: JSON.stringify({
        name: 'My Password',
        category: 'login',
        secretValue: 'super-secret-password',
        tags: ['work'],
        url: 'https://example.com',
      }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
    expect(body.data.itemId).toBeDefined();
    expect(body.data.name).toBe('My Password');
    expect(body.data.secretValue).toBeUndefined();
  });

  it('memo 필드가 있으면 KMS 암호화가 2번 호출되어야 한다', async () => {
    const mockDocSend = vi.fn().mockResolvedValue({});
    const mockKmsSend = vi.fn().mockResolvedValue({
      CiphertextBlob: Buffer.from('encrypted'),
    });
    const handler = await setupHandler(mockDocSend, mockKmsSend);

    const event = makeEvent({
      resource: '/secrets',
      httpMethod: 'POST',
      body: JSON.stringify({
        name: 'Test',
        category: 'login',
        secretValue: 'secret',
        memo: '이것은 메모입니다',
      }),
    });
    await handler(event);

    // secretValue + memo = KMS 2번 호출
    expect(mockKmsSend).toHaveBeenCalledTimes(2);
  });
});

// ==============================================================================
// updateSecret - PUT /secrets/{itemId}
// ==============================================================================

describe('handler - PUT /secrets/{itemId} (시크릿 수정)', () => {
  it('존재하지 않는 itemId 수정 요청 시 404를 반환해야 한다', async () => {
    const mockSend = vi.fn().mockResolvedValue(makeQueryResult([]));
    const handler = await setupHandler(mockSend);

    const event = makeEvent({
      resource: '/secrets/{itemId}',
      httpMethod: 'PUT',
      pathParameters: { itemId: 'nonexistent' },
      body: JSON.stringify({ name: 'Updated Name' }),
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
  });

  it('카테고리 변경 없이 name만 수정하면 200을 반환해야 한다', async () => {
    const existingItem = makeSecretItem();
    const mockSend = vi.fn()
      .mockResolvedValueOnce(makeQueryResult([existingItem])) // query
      .mockResolvedValueOnce({}); // put
    const mockKmsSend = vi.fn().mockResolvedValue({
      CiphertextBlob: Buffer.from('encrypted'),
    });
    const handler = await setupHandler(mockSend, mockKmsSend);

    const event = makeEvent({
      resource: '/secrets/{itemId}',
      httpMethod: 'PUT',
      pathParameters: { itemId: 'item-uuid-5678' },
      body: JSON.stringify({ name: 'Updated Name' }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data.name).toBe('Updated Name');
  });

  it('카테고리 변경 시 기존 항목 삭제 후 새 SK로 생성해야 한다', async () => {
    const existingItem = makeSecretItem({ category: 'login' });
    const mockSend = vi.fn()
      .mockResolvedValueOnce(makeQueryResult([existingItem])) // query
      .mockResolvedValueOnce({}) // delete
      .mockResolvedValueOnce({}); // put
    const mockKmsSend = vi.fn().mockResolvedValue({
      CiphertextBlob: Buffer.from('encrypted'),
    });
    const handler = await setupHandler(mockSend, mockKmsSend);

    const event = makeEvent({
      resource: '/secrets/{itemId}',
      httpMethod: 'PUT',
      pathParameters: { itemId: 'item-uuid-5678' },
      body: JSON.stringify({ category: 'certificates' }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data.category).toBe('certificates');
    // delete + put = 3번 호출 (query + delete + put)
    expect(mockSend).toHaveBeenCalledTimes(3);
  });
});

// ==============================================================================
// deleteSecret - DELETE /secrets/{itemId}
// ==============================================================================

describe('handler - DELETE /secrets/{itemId} (시크릿 삭제)', () => {
  it('존재하지 않는 itemId 삭제 요청 시 404를 반환해야 한다', async () => {
    const mockSend = vi.fn().mockResolvedValue(makeQueryResult([]));
    const handler = await setupHandler(mockSend);

    const event = makeEvent({
      resource: '/secrets/{itemId}',
      httpMethod: 'DELETE',
      pathParameters: { itemId: 'nonexistent' },
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
  });

  it('정상 삭제 시 itemId와 deleted:true를 반환해야 한다', async () => {
    const mockSend = vi.fn()
      .mockResolvedValueOnce(makeQueryResult([makeSecretItem()]))
      .mockResolvedValueOnce({});
    const handler = await setupHandler(mockSend);

    const event = makeEvent({
      resource: '/secrets/{itemId}',
      httpMethod: 'DELETE',
      pathParameters: { itemId: 'item-uuid-5678' },
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
    expect(body.data.deleted).toBe(true);
    expect(body.data.itemId).toBe('item-uuid-5678');
  });
});

// ==============================================================================
// listCategories - GET /categories
// ==============================================================================

describe('handler - GET /categories (카테고리 목록 조회)', () => {
  it('카테고리 목록을 중복 없이 반환해야 한다', async () => {
    const mockSend = vi.fn().mockResolvedValue(
      makeQueryResult([
        { category: 'login' },
        { category: 'certificate' },
        { category: 'login' }, // 중복
      ])
    );
    const handler = await setupHandler(mockSend);

    const event = makeEvent({ resource: '/categories', httpMethod: 'GET' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data).toEqual(['login', 'certificate']);
  });

  it('시크릿 없으면 빈 카테고리 목록을 반환해야 한다', async () => {
    const mockSend = vi.fn().mockResolvedValue(makeQueryResult([]));
    const handler = await setupHandler(mockSend);

    const event = makeEvent({ resource: '/categories', httpMethod: 'GET' });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body.data).toEqual([]);
  });
});

// ==============================================================================
// handleLambdaError - 에러 처리
// ==============================================================================

describe('handler - 에러 처리 (handleLambdaError)', () => {
  it('KMS AccessDeniedException 발생 시 500 ENCRYPTION_ERROR를 반환해야 한다', async () => {
    const kmsError = new Error('KMS access denied');
    kmsError.name = 'AccessDeniedException';
    const mockSend = vi.fn().mockRejectedValue(kmsError);
    const handler = await setupHandler(mockSend);

    const event = makeEvent({ resource: '/secrets', httpMethod: 'GET' });
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('ENCRYPTION_ERROR');
  });

  it('DynamoDB ValidationException 발생 시 500 DATABASE_ERROR를 반환해야 한다', async () => {
    const ddbError = new Error('DynamoDB validation');
    ddbError.name = 'ValidationException';
    const mockSend = vi.fn().mockRejectedValue(ddbError);
    const handler = await setupHandler(mockSend);

    const event = makeEvent({ resource: '/secrets', httpMethod: 'GET' });
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('DATABASE_ERROR');
  });

  it('일반 에러 발생 시 500 INTERNAL_ERROR를 반환해야 한다', async () => {
    const genericError = new Error('Something went wrong');
    genericError.name = 'UnknownError';
    const mockSend = vi.fn().mockRejectedValue(genericError);
    const handler = await setupHandler(mockSend);

    const event = makeEvent({ resource: '/secrets', httpMethod: 'GET' });
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('KMS DisabledException 발생 시 500 ENCRYPTION_ERROR를 반환해야 한다', async () => {
    const kmsError = new Error('KMS key disabled');
    kmsError.name = 'DisabledException';
    const mockSend = vi.fn().mockRejectedValue(kmsError);
    const handler = await setupHandler(mockSend);

    const event = makeEvent({ resource: '/secrets', httpMethod: 'GET' });
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('ENCRYPTION_ERROR');
  });

  it('DynamoDB ResourceNotFoundException 발생 시 500 DATABASE_ERROR를 반환해야 한다', async () => {
    const ddbError = new Error('Table not found');
    ddbError.name = 'ResourceNotFoundException';
    const mockSend = vi.fn().mockRejectedValue(ddbError);
    const handler = await setupHandler(mockSend);

    const event = makeEvent({ resource: '/secrets', httpMethod: 'GET' });
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('DATABASE_ERROR');
  });
});
