// ==============================================================================
// modules/won-dashboard/lambda/collector.test.mjs
// AWS 비용 수집 배치 Lambda 단위 테스트
// CostExplorer와 S3를 모킹하여 비용 수집 로직 검증
// ==============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- AWS SDK 모킹 ---
vi.mock('@aws-sdk/client-cost-explorer', () => ({
  CostExplorerClient: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  GetCostAndUsageCommand: vi.fn().mockImplementation((input) => input),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  PutObjectCommand: vi.fn().mockImplementation((input) => input),
}));

import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { handler } from './collector.mjs';

// ==============================================================================
// 비용 수집 배치 핸들러 테스트
// ==============================================================================

describe('collector handler - AWS 비용 수집 배치', () => {
  let mockCostSend;
  let mockS3Send;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.S3_BUCKET_NAME = 'test-cost-cache-bucket';

    // Cost Explorer 모킹 - monthly + service 두 번 호출
    mockCostSend = vi.fn().mockResolvedValue({
      ResultsByTime: [
        {
          TimePeriod: { Start: '2026-01-01', End: '2026-02-01' },
          Total: { UnblendedCost: { Amount: '100.00', Unit: 'USD' } },
        },
      ],
    });
    CostExplorerClient.mockImplementation(() => ({ send: mockCostSend }));

    // S3 PutObject 모킹
    mockS3Send = vi.fn().mockResolvedValue({});
    S3Client.mockImplementation(() => ({ send: mockS3Send }));
  });

  afterEach(() => {
    delete process.env.S3_BUCKET_NAME;
  });

  it('Cost Explorer API를 두 번 호출하고 S3에 결과를 저장해야 한다', async () => {
    const result = await handler({});

    // statusCode 200 반환 확인
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('Success');

    // Cost Explorer가 2번 호출 (monthly + services)
    expect(mockCostSend).toHaveBeenCalledTimes(2);

    // S3 PutObject가 1번 호출
    expect(mockS3Send).toHaveBeenCalledTimes(1);
  });

  it('S3에 저장되는 데이터에 monthly와 services 필드가 있어야 한다', async () => {
    await handler({});

    // S3 send에 전달된 첫 번째 명령 확인
    const s3Call = mockS3Send.mock.calls[0][0];
    // Body에 올바른 JSON이 포함되어 있는지 확인
    const savedBody = JSON.parse(s3Call.Body);
    expect(savedBody).toHaveProperty('monthly');
    expect(savedBody).toHaveProperty('services');
    expect(Array.isArray(savedBody.monthly)).toBe(true);
    expect(Array.isArray(savedBody.services)).toBe(true);
  });

  it('S3 버킷 이름으로 환경변수 S3_BUCKET_NAME을 사용해야 한다', async () => {
    await handler({});

    const s3Call = mockS3Send.mock.calls[0][0];
    expect(s3Call.Bucket).toBe('test-cost-cache-bucket');
    expect(s3Call.Key).toBe('aws-cost-cache.json');
    expect(s3Call.ContentType).toBe('application/json');
  });

  it('날짜 범위가 6개월 전부터 내일까지로 설정되어야 한다', async () => {
    await handler({});

    // Cost Explorer send에 전달된 첫 번째 명령 (monthly)
    const monthlyCall = mockCostSend.mock.calls[0][0];
    const endDate = new Date(monthlyCall.TimePeriod.End);
    const startDate = new Date(monthlyCall.TimePeriod.Start);

    // 종료일이 내일 이후인지 확인
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    // 날짜 부분만 비교 (시간 제외)
    expect(endDate.toDateString()).toBe(tomorrow.toDateString());

    // 시작일이 현재 기준 약 5-6개월 전인지 확인
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    expect(startDate.getTime()).toBeLessThanOrEqual(sixMonthsAgo.getTime() + 24 * 60 * 60 * 1000);
  });

  it('월별 쿼리 Granularity가 MONTHLY이어야 한다', async () => {
    await handler({});

    const monthlyCall = mockCostSend.mock.calls[0][0];
    expect(monthlyCall.Granularity).toBe('MONTHLY');
  });

  it('서비스별 쿼리에 GroupBy SERVICE 설정이 있어야 한다', async () => {
    await handler({});

    // 두 번째 호출은 service별 쿼리
    const serviceCall = mockCostSend.mock.calls[1][0];
    expect(serviceCall.GroupBy).toEqual([{ Type: 'DIMENSION', Key: 'SERVICE' }]);
  });

  it('Cost Explorer 조회 실패 시 에러를 throw해야 한다', async () => {
    mockCostSend.mockRejectedValue(new Error('AccessDenied'));
    CostExplorerClient.mockImplementation(() => ({ send: mockCostSend }));

    await expect(handler({})).rejects.toThrow('AccessDenied');
  });

  it('S3 저장 실패 시 에러를 throw해야 한다', async () => {
    mockS3Send.mockRejectedValue(new Error('NoSuchBucket'));
    S3Client.mockImplementation(() => ({ send: mockS3Send }));

    await expect(handler({})).rejects.toThrow('NoSuchBucket');
  });

  it('AWS_COST_REGION 환경변수로 리전을 설정해야 한다', async () => {
    process.env.AWS_COST_REGION = 'us-west-2';
    await handler({});

    // CostExplorerClient가 us-west-2로 초기화되었는지 확인
    expect(CostExplorerClient).toHaveBeenCalledWith({ region: 'us-west-2' });
    delete process.env.AWS_COST_REGION;
  });

  it('AWS_COST_REGION 환경변수 없으면 기본값 us-east-1을 사용해야 한다', async () => {
    delete process.env.AWS_COST_REGION;
    await handler({});

    expect(CostExplorerClient).toHaveBeenCalledWith({ region: 'us-east-1' });
  });

  // 한글 설명 주석: AWS_REGION 환경변수가 설정되어 있을 때 S3Client가 해당 리전 값으로 초기화되는지 검증합니다.
  it('AWS_REGION 환경변수가 있을 경우 S3Client는 AWS_REGION 값을 사용해야 한다', async () => {
    process.env.AWS_REGION = 'us-west-2';
    await handler({});

    expect(S3Client).toHaveBeenCalledWith({ region: 'us-west-2' });
    delete process.env.AWS_REGION;
  });

  // 한글 설명 주석: AWS_REGION 환경변수가 없을 경우 S3Client는 기본값 ap-northeast-2를 사용해야 한다.
  it('AWS_REGION 환경변수가 없을 경우 S3Client는 기본값 ap-northeast-2를 사용해야 한다', async () => {
    delete process.env.AWS_REGION;
    await handler({});

    expect(S3Client).toHaveBeenCalledWith({ region: 'ap-northeast-2' });
  });
});
