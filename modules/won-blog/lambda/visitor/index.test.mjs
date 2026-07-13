// ==============================================================================
// modules/won-blog/lambda/visitor/index.test.mjs
// IP 기반 방문자 통계 Lambda 단위 테스트
// vi.doMock() + vi.resetModules() 패턴으로 모듈 레벨 초기화 문제 해결
// ==============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==============================================================================
// 모킹 헬퍼 함수
// ==============================================================================

/**
 * DynamoDB 클라이언트를 모킹하고 handler를 동적으로 임포트합니다.
 */
async function setupHandler({ ddbSend = vi.fn() } = {}) {
  vi.resetModules();

  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn().mockImplementation(() => ({ send: ddbSend })),
    PutItemCommand: vi.fn().mockImplementation((input) => ({ __type: 'PutItemCommand', ...input })),
    UpdateItemCommand: vi.fn().mockImplementation((input) => ({ __type: 'UpdateItemCommand', ...input })),
    QueryCommand: vi.fn().mockImplementation((input) => ({ __type: 'QueryCommand', ...input })),
  }));

  const { handler } = await import('./index.mjs');
  return handler;
}

beforeEach(() => {
  process.env.TABLE_NAME = 'won-blog-visitor-table';
});

afterEach(() => {
  delete process.env.TABLE_NAME;
  vi.resetModules();
});

// ==============================================================================
// 헬퍼 함수
// ==============================================================================

function makeEvent(fieldName, overrides = {}) {
  return {
    info: { fieldName },
    arguments: {},
    identity: { sourceIp: ['1.2.3.4'] },
    request: { headers: {} },
    ...overrides,
  };
}

function makeVisitorItem(sk, count) {
  return {
    PK: { S: 'VISITOR' },
    SK: { S: sk },
    count: { N: String(count) },
  };
}

function makeQueryResult(items = []) {
  return { Items: items };
}

// ==============================================================================
// recordVisit - 방문자 기록
// ==============================================================================

describe('handler - recordVisit (방문자 기록)', () => {
  it('신규 방문자는 카운터를 증가시키고 통계를 반환해야 한다', async () => {
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayStr = kstNow.toISOString().split('T')[0];
    const yesterdayDate = new Date(kstNow.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

    const ddbSend = vi.fn()
      .mockResolvedValueOnce({}) // PutItemCommand - 신규 방문
      .mockResolvedValueOnce({}) // UpdateItemCommand - 오늘 카운터
      .mockResolvedValueOnce({}) // UpdateItemCommand - TOTAL 카운터
      .mockResolvedValueOnce(makeQueryResult([ // QueryCommand - 통계 조회
        makeVisitorItem(todayStr, 5),
        makeVisitorItem(yesterdayStr, 3),
        makeVisitorItem('TOTAL', 100),
      ]));
    const handler = await setupHandler({ ddbSend });

    const result = await handler(makeEvent('recordVisit'));

    expect(result).toEqual({ today: 5, yesterday: 3, total: 100 });
    expect(ddbSend).toHaveBeenCalledTimes(4);
  });

  it('이미 방문한 IP는 카운터를 증가시키지 않아야 한다', async () => {
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayStr = kstNow.toISOString().split('T')[0];
    const yesterdayDate = new Date(kstNow.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

    const conditionalError = new Error('Condition failed');
    conditionalError.name = 'ConditionalCheckFailedException';

    const ddbSend = vi.fn()
      .mockRejectedValueOnce(conditionalError) // PutItemCommand - 이미 방문
      .mockResolvedValueOnce(makeQueryResult([ // QueryCommand - 통계 조회만
        makeVisitorItem(todayStr, 5),
        makeVisitorItem(yesterdayStr, 3),
        makeVisitorItem('TOTAL', 100),
      ]));
    const handler = await setupHandler({ ddbSend });

    const result = await handler(makeEvent('recordVisit'));

    expect(result.today).toBe(5);
    // 2번만 호출 (PutItem + Query, UpdateItem은 호출 안 됨)
    expect(ddbSend).toHaveBeenCalledTimes(2);
  });

  it('IP가 없으면 "unknown"으로 처리해야 한다', async () => {
    const ddbSend = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(makeQueryResult([]));
    const handler = await setupHandler({ ddbSend });

    const event = {
      info: { fieldName: 'recordVisit' },
      arguments: {},
      identity: {}, // sourceIp 없음
      request: { headers: {} },
    };

    const result = await handler(event);
    expect(result).toBeDefined();
  });

  it('x-forwarded-for 헤더에서 IP를 추출해야 한다', async () => {
    const ddbSend = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(makeQueryResult([]));
    const handler = await setupHandler({ ddbSend });

    const event = {
      info: { fieldName: 'recordVisit' },
      arguments: {},
      identity: {},
      request: { headers: { 'x-forwarded-for': '10.0.0.1, 172.16.0.1' } },
    };

    const result = await handler(event);
    expect(result).toBeDefined();
  });
});

// ==============================================================================
// recordPostView - 글 조회수 기록
// ==============================================================================

describe('handler - recordPostView (글 조회수 기록)', () => {
  it('postId 없으면 에러를 throw해야 한다', async () => {
    const handler = await setupHandler({ ddbSend: vi.fn() });

    await expect(handler(makeEvent('recordPostView', { arguments: {} }))).rejects.toThrow('postId is required');
  });

  it('신규 조회 시 viewCount를 증가시키고 반환해야 한다', async () => {
    const ddbSend = vi.fn()
      .mockResolvedValueOnce({}) // PutItemCommand - 신규 조회
      .mockResolvedValueOnce({  // UpdateItemCommand - viewCount +1
        Attributes: { viewCount: { N: '11' } },
      });
    const handler = await setupHandler({ ddbSend });

    const result = await handler(makeEvent('recordPostView', {
      arguments: { postId: 'post-uuid-1234' },
    }));

    expect(result).toEqual({ viewCount: 11 });
  });

  it('이미 조회한 IP는 viewCount를 증가시키지 않고 현재 값을 반환해야 한다', async () => {
    const conditionalError = new Error('Condition failed');
    conditionalError.name = 'ConditionalCheckFailedException';

    const ddbSend = vi.fn()
      .mockRejectedValueOnce(conditionalError) // PutItemCommand - 이미 조회
      .mockResolvedValueOnce(makeQueryResult([{ viewCount: { N: '10' } }])); // Query
    const handler = await setupHandler({ ddbSend });

    const result = await handler(makeEvent('recordPostView', {
      arguments: { postId: 'post-uuid-1234' },
    }));

    expect(result).toEqual({ viewCount: 10 });
  });

  it('이미 조회했지만 viewCount 데이터 없으면 0을 반환해야 한다', async () => {
    const conditionalError = new Error('Condition failed');
    conditionalError.name = 'ConditionalCheckFailedException';

    const ddbSend = vi.fn()
      .mockRejectedValueOnce(conditionalError)
      .mockResolvedValueOnce(makeQueryResult([]));
    const handler = await setupHandler({ ddbSend });

    const result = await handler(makeEvent('recordPostView', {
      arguments: { postId: 'new-post-id' },
    }));

    expect(result).toEqual({ viewCount: 0 });
  });

  it('DynamoDB 예기치 않은 에러는 throw해야 한다', async () => {
    const unexpectedError = new Error('ServiceUnavailable');
    unexpectedError.name = 'ServiceUnavailableException';

    const ddbSend = vi.fn().mockRejectedValue(unexpectedError);
    const handler = await setupHandler({ ddbSend });

    await expect(handler(makeEvent('recordPostView', {
      arguments: { postId: 'post-1' },
    }))).rejects.toThrow('ServiceUnavailable');
  });
});

// ==============================================================================
// 알 수 없는 fieldName 처리
// ==============================================================================

describe('handler - 알 수 없는 fieldName', () => {
  it('알 수 없는 fieldName은 에러를 throw해야 한다', async () => {
    const handler = await setupHandler({ ddbSend: vi.fn() });

    await expect(handler(makeEvent('unknownField'))).rejects.toThrow('Unknown field: unknownField');
  });
});

// ==============================================================================
// TTL 및 날짜 계산 검증
// ==============================================================================

describe('handler - TTL 및 날짜 계산', () => {
  it('TTL이 현재 시점 + 90일로 설정되어야 한다', async () => {
    // PutItemCommand 호출 인자는 ddbSend의 첫 번째 호출로 검사
    const ddbSend = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(makeQueryResult([]));
    const handler = await setupHandler({ ddbSend });

    const beforeCall = Math.floor(Date.now() / 1000);
    await handler(makeEvent('recordVisit'));
    const afterCall = Math.floor(Date.now() / 1000);

    // ddbSend의 첫 번째 호출 인자에서 PutItemCommand 내용 확인
    const firstCallArg = ddbSend.mock.calls[0][0];
    // PutItemCommand mock은 입력 그대로 반환하므로 Item 속성이 존재해야 함
    expect(firstCallArg.Item).toBeDefined();
    const ttl = parseInt(firstCallArg.Item.ttl.N);

    const expectedTtlMin = beforeCall + 90 * 24 * 60 * 60;
    const expectedTtlMax = afterCall + 90 * 24 * 60 * 60;
    expect(ttl).toBeGreaterThanOrEqual(expectedTtlMin);
    expect(ttl).toBeLessThanOrEqual(expectedTtlMax);
  });

  it('DynamoDB PutItemCommand에 ConditionExpression이 설정되어야 한다', async () => {
    const { PutItemCommand } = await import('@aws-sdk/client-dynamodb');

    const ddbSend = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(makeQueryResult([]));
    const handler = await setupHandler({ ddbSend });

    await handler(makeEvent('recordVisit'));

    const putCall = PutItemCommand.mock.calls[0][0];
    expect(putCall.ConditionExpression).toBe('attribute_not_exists(PK)');
  });

  it('오늘 날짜 카운터 UpdateItemCommand에 올바른 Key가 설정되어야 한다', async () => {
    const { UpdateItemCommand } = await import('@aws-sdk/client-dynamodb');

    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayStr = kstNow.toISOString().split('T')[0];

    const ddbSend = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(makeQueryResult([]));
    const handler = await setupHandler({ ddbSend });

    await handler(makeEvent('recordVisit'));

    // 첫 번째 UpdateItemCommand (오늘 카운터)
    const updateTodayCall = UpdateItemCommand.mock.calls[0][0];
    expect(updateTodayCall.Key.PK.S).toBe('VISITOR');
    expect(updateTodayCall.Key.SK.S).toBe(todayStr);
    expect(updateTodayCall.UpdateExpression).toBe('ADD #count :inc');

    // 두 번째 UpdateItemCommand (TOTAL 카운터)
    const updateTotalCall = UpdateItemCommand.mock.calls[1][0];
    expect(updateTotalCall.Key.SK.S).toBe('TOTAL');
  });
});
