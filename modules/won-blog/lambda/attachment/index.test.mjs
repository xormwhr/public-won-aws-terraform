// ==============================================================================
// modules/won-blog/lambda/attachment/index.test.mjs
// S3 Presigned URL 생성 Lambda 단위 테스트
// vi.doMock() + vi.resetModules() 패턴으로 모듈 레벨 초기화 문제 해결
// ==============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==============================================================================
// 모킹 헬퍼 함수
// ==============================================================================

/**
 * S3Client와 getSignedUrl을 모킹하고 handler를 동적으로 임포트합니다.
 */
async function setupHandler({ s3Send = vi.fn(), signedUrl = 'https://s3.amazonaws.com/test-bucket/presigned-url?X-Amz-Signature=test' } = {}) {
  vi.resetModules();

  vi.doMock('@aws-sdk/client-s3', () => ({
    S3Client: vi.fn().mockImplementation(() => ({ send: s3Send })),
    PutObjectCommand: vi.fn().mockImplementation((input) => ({ __type: 'PutObjectCommand', ...input })),
  }));

  vi.doMock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: vi.fn().mockResolvedValue(signedUrl),
  }));

  const { handler } = await import('./index.mjs');
  return handler;
}

beforeEach(() => {
  process.env.BUCKET_NAME = 'test-attachments-bucket';
});

afterEach(() => {
  delete process.env.BUCKET_NAME;
  vi.resetModules();
});

// ==============================================================================
// AppSync 이벤트 헬퍼
// ==============================================================================

function makeEvent(args = {}) {
  return {
    info: { fieldName: 'getPresignedUploadUrl' },
    arguments: {
      postId: 'post-uuid-1234',
      fileName: 'document.pdf',
      contentType: 'application/pdf',
      fileSize: 1024 * 1024, // 1MB
      ...args,
    },
  };
}

// ==============================================================================
// getPresignedUploadUrl 테스트
// ==============================================================================

describe('handler - getPresignedUploadUrl', () => {
  it('유효한 파일로 Presigned URL을 생성해야 한다', async () => {
    const handler = await setupHandler();

    const result = await handler(makeEvent());
    expect(result.url).toContain('presigned-url');
    expect(result.s3Key).toMatch(/^attachments\/post-uuid-1234\/.+document\.pdf$/);
  });

  it('PutObjectCommand가 올바른 Bucket, Key, ContentType으로 호출되어야 한다', async () => {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const handler = await setupHandler();

    await handler(makeEvent());

    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'test-attachments-bucket',
        Key: expect.stringMatching(/^attachments\/post-uuid-1234\/.+document\.pdf$/),
        ContentType: 'application/pdf',
      })
    );
  });

  it('getSignedUrl이 5분(300초) 만료로 호출되어야 한다', async () => {
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const handler = await setupHandler();

    await handler(makeEvent());

    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      { expiresIn: 300 }
    );
  });

  it('파일 크기가 50MB를 초과하면 에러를 throw해야 한다', async () => {
    const handler = await setupHandler();

    await expect(handler(makeEvent({
      fileName: 'huge-file.pdf',
      contentType: 'application/pdf',
      fileSize: 51 * 1024 * 1024,
    }))).rejects.toThrow('50MB');
  });

  it('허용되지 않는 확장자 파일은 에러를 throw해야 한다', async () => {
    const handler = await setupHandler();

    await expect(handler(makeEvent({
      fileName: 'virus.exe',
      contentType: 'application/octet-stream',
      fileSize: 1024,
    }))).rejects.toThrow('허용되지 않는 파일 형식');
  });

  it('허용되지 않는 Content-Type은 에러를 throw해야 한다', async () => {
    const handler = await setupHandler();

    await expect(handler(makeEvent({
      fileName: 'file.txt',
      contentType: 'application/x-binary',
      fileSize: 1024,
    }))).rejects.toThrow('허용되지 않는 Content-Type');
  });

  it('postId, fileName, contentType 중 하나가 없으면 에러를 throw해야 한다', async () => {
    const handler = await setupHandler();

    await expect(handler(makeEvent({ postId: '' }))).rejects.toThrow('필수');
  });

  it('확장자가 없는 파일명은 에러를 throw해야 한다', async () => {
    const handler = await setupHandler();

    await expect(handler(makeEvent({
      fileName: 'no-extension',
      contentType: 'application/pdf',
      fileSize: 1024,
    }))).rejects.toThrow('허용되지 않는 파일 형식');
  });

  it('이미지 파일(jpg)이 허용되어야 한다', async () => {
    const handler = await setupHandler();

    const result = await handler(makeEvent({
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
      fileSize: 2 * 1024 * 1024,
    }));
    expect(result.url).toBeDefined();
    expect(result.s3Key).toContain('photo.jpg');
  });

  it('PNG 이미지 파일이 허용되어야 한다', async () => {
    const handler = await setupHandler();

    const result = await handler(makeEvent({
      fileName: 'screenshot.png',
      contentType: 'image/png',
      fileSize: 1 * 1024 * 1024,
    }));
    expect(result.url).toBeDefined();
  });

  it('ZIP 파일이 허용되어야 한다', async () => {
    const handler = await setupHandler();

    const result = await handler(makeEvent({
      fileName: 'archive.zip',
      contentType: 'application/zip',
      fileSize: 10 * 1024 * 1024,
    }));
    expect(result.url).toBeDefined();
  });

  it('Markdown(.md) 파일이 허용되어야 한다', async () => {
    const handler = await setupHandler();

    const result = await handler(makeEvent({
      fileName: 'README.md',
      contentType: 'text/markdown',
      fileSize: 50 * 1024,
    }));
    expect(result.url).toBeDefined();
  });

  it('파일명의 특수문자가 언더스코어로 치환되어야 한다', async () => {
    const handler = await setupHandler();

    const result = await handler(makeEvent({
      fileName: 'my file (1).pdf',
      contentType: 'application/pdf',
      fileSize: 1024,
    }));
    // 공백과 괄호가 언더스코어로 치환되어야 함
    expect(result.s3Key).not.toContain(' ');
    expect(result.s3Key).not.toContain('(');
  });

  it('fileSize가 없으면 0으로 처리되어 유효성 검사를 통과해야 한다', async () => {
    const handler = await setupHandler();

    const result = await handler({
      info: { fieldName: 'getPresignedUploadUrl' },
      arguments: {
        postId: 'post-1',
        fileName: 'test.pdf',
        contentType: 'application/pdf',
      },
    });
    expect(result.url).toBeDefined();
  });
});

// ==============================================================================
// 알 수 없는 fieldName 처리
// ==============================================================================

describe('handler - 알 수 없는 fieldName', () => {
  it('알 수 없는 fieldName은 에러를 throw해야 한다', async () => {
    const handler = await setupHandler();

    await expect(handler({
      info: { fieldName: 'unknownField' },
      arguments: {},
    })).rejects.toThrow('Unknown field: unknownField');
  });
});
