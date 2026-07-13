// ==============================================================================
// modules/won-blog/lambda/post/index.test.mjs
// 포스트 삭제 Lambda 단위 테스트
// vi.doMock() + vi.resetModules() 패턴으로 모듈 레벨 초기화 문제 해결
// ==============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==============================================================================
// 모킹 헬퍼 함수
// ==============================================================================

/**
 * DynamoDB, S3 클라이언트를 모킹하고 handler를 동적으로 임포트합니다.
 */
async function setupHandler({ ddbSend = vi.fn(), s3Send = vi.fn() } = {}) {
  vi.resetModules();

  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn().mockImplementation(() => ({ send: ddbSend })),
    GetItemCommand: vi.fn().mockImplementation((input) => ({ __type: 'GetItemCommand', ...input })),
    DeleteItemCommand: vi.fn().mockImplementation((input) => ({ __type: 'DeleteItemCommand', ...input })),
  }));

  vi.doMock('@aws-sdk/client-s3', () => ({
    S3Client: vi.fn().mockImplementation(() => ({ send: s3Send })),
    DeleteObjectsCommand: vi.fn().mockImplementation((input) => ({ __type: 'DeleteObjectsCommand', ...input })),
  }));

  // marshall/unmarshall은 단순 패스스루로 모킹
  vi.doMock('@aws-sdk/util-dynamodb', () => ({
    marshall: vi.fn().mockImplementation((obj) => obj),
    unmarshall: vi.fn().mockImplementation((obj) => obj),
  }));

  const { handler } = await import('./index.mjs');
  return handler;
}

beforeEach(() => {
  process.env.TABLE_NAME = 'won-blog-table';
  process.env.BUCKET_NAME = 'won-blog-attachments-bucket';
});

afterEach(() => {
  delete process.env.TABLE_NAME;
  delete process.env.BUCKET_NAME;
  vi.resetModules();
});

// ==============================================================================
// AppSync 이벤트 헬퍼
// ==============================================================================

function makeEvent(override = {}) {
  return {
    identity: { username: 'admin-user', sub: 'admin-sub-uuid' },
    arguments: { id: 'post-uuid-1234' },
    ...override,
  };
}

/**
 * DynamoDB GetItemCommand 결과 생성 헬퍼
 */
function makePostItem(attachments = []) {
  return {
    Item: {
      PK: 'POST#post-uuid-1234',
      SK: 'POST#post-uuid-1234',
      id: 'post-uuid-1234',
      title: 'Test Post',
      attachments,
    },
  };
}

// ==============================================================================
// 인증 검증
// ==============================================================================

describe('handler - 인증 검증', () => {
  it('identity 없으면 Unauthorized 에러를 throw해야 한다', async () => {
    const handler = await setupHandler({ ddbSend: vi.fn() });

    await expect(handler(makeEvent({ identity: null }))).rejects.toThrow('Unauthorized');
  });

  it('identity 있으면 인증 통과하여 처리를 진행해야 한다', async () => {
    const ddbSend = vi.fn()
      .mockResolvedValueOnce(makePostItem([]))
      .mockResolvedValueOnce({});
    const handler = await setupHandler({ ddbSend });

    const result = await handler(makeEvent());
    expect(result).toBeDefined();
  });
});

// ==============================================================================
// 포스트 삭제 - 첨부파일 없는 경우
// ==============================================================================

describe('handler - 포스트 삭제 (첨부파일 없음)', () => {
  it('첨부파일 없는 포스트 삭제 시 DynamoDB만 삭제해야 한다', async () => {
    const ddbSend = vi.fn()
      .mockResolvedValueOnce(makePostItem([]))
      .mockResolvedValueOnce({});
    const s3Send = vi.fn();
    const handler = await setupHandler({ ddbSend, s3Send });

    await handler(makeEvent());

    // DynamoDB가 2번 호출 (Get + Delete)
    expect(ddbSend).toHaveBeenCalledTimes(2);
    // S3가 호출되지 않아야 함
    expect(s3Send).not.toHaveBeenCalled();
  });

  it('존재하지 않는 포스트 삭제 요청 시 Post not found 에러를 throw해야 한다', async () => {
    const ddbSend = vi.fn().mockResolvedValue({ Item: null });
    const handler = await setupHandler({ ddbSend });

    await expect(handler(makeEvent())).rejects.toThrow('Post not found');
  });
});

// ==============================================================================
// 포스트 삭제 - 첨부파일 있는 경우
// ==============================================================================

describe('handler - 포스트 삭제 (첨부파일 있음)', () => {
  it('첨부파일이 있으면 S3에서도 첨부파일을 삭제해야 한다', async () => {
    const attachments = [
      { s3Key: 'attachments/post-uuid-1234/uuid1_document.pdf', name: 'document.pdf' },
      { s3Key: 'attachments/post-uuid-1234/uuid2_image.jpg', name: 'image.jpg' },
    ];
    const ddbSend = vi.fn()
      .mockResolvedValueOnce(makePostItem(attachments))
      .mockResolvedValueOnce({});
    const s3Send = vi.fn().mockResolvedValue({});
    const handler = await setupHandler({ ddbSend, s3Send });

    await handler(makeEvent());

    // S3 DeleteObjectsCommand가 호출되어야 함
    expect(s3Send).toHaveBeenCalledTimes(1);
  });

  it('s3Key가 없는 첨부파일은 S3 삭제 대상에서 제외해야 한다', async () => {
    const attachments = [
      { s3Key: 'attachments/post-1/uuid1_file.pdf', name: 'file.pdf' },
      { name: 'no-key-file.txt' },
    ];
    const ddbSend = vi.fn()
      .mockResolvedValueOnce(makePostItem(attachments))
      .mockResolvedValueOnce({});
    const s3Send = vi.fn().mockResolvedValue({});
    const handler = await setupHandler({ ddbSend, s3Send });

    await handler(makeEvent());

    // s3Key 있는 파일 1개만 삭제 대상
    const s3Call = s3Send.mock.calls[0][0];
    expect(s3Call.Delete.Objects).toHaveLength(1);
    expect(s3Call.Delete.Objects[0].Key).toBe('attachments/post-1/uuid1_file.pdf');
  });

  it('s3Key 있는 첨부파일이 없으면 S3 삭제를 호출하지 않아야 한다', async () => {
    const attachments = [{ name: 'no-key-1.txt' }, { name: 'no-key-2.txt' }];
    const ddbSend = vi.fn()
      .mockResolvedValueOnce(makePostItem(attachments))
      .mockResolvedValueOnce({});
    const s3Send = vi.fn();
    const handler = await setupHandler({ ddbSend, s3Send });

    await handler(makeEvent());

    expect(s3Send).not.toHaveBeenCalled();
  });
});

// ==============================================================================
// DynamoDB Key 구성 검증
// ==============================================================================

describe('handler - DynamoDB Key 구성', () => {
  it('postId를 사용하여 올바른 PK/SK를 구성해야 한다', async () => {
    const { GetItemCommand } = await import('@aws-sdk/client-dynamodb');
    const ddbSend = vi.fn()
      .mockResolvedValueOnce(makePostItem([]))
      .mockResolvedValueOnce({});
    const handler = await setupHandler({ ddbSend });

    await handler(makeEvent({ arguments: { id: 'my-special-post-id' } }));

    expect(GetItemCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'won-blog-table',
        Key: expect.objectContaining({ PK: expect.anything(), SK: expect.anything() }),
      })
    );
  });
});

// ==============================================================================
// 에러 처리
// ==============================================================================

describe('handler - 에러 처리', () => {
  it('DynamoDB GetItem 실패 시 에러를 throw해야 한다', async () => {
    const ddbSend = vi.fn().mockRejectedValue(new Error('DynamoDB connection error'));
    const handler = await setupHandler({ ddbSend });

    await expect(handler(makeEvent())).rejects.toThrow('DynamoDB connection error');
  });

  it('S3 DeleteObjects 실패 시 에러를 throw해야 한다', async () => {
    const attachments = [{ s3Key: 'attachments/post-1/file.pdf' }];
    const ddbSend = vi.fn()
      .mockResolvedValueOnce(makePostItem(attachments))
      .mockResolvedValueOnce({});
    const s3Send = vi.fn().mockRejectedValue(new Error('S3 access denied'));
    const handler = await setupHandler({ ddbSend, s3Send });

    await expect(handler(makeEvent())).rejects.toThrow('S3 access denied');
  });
});
