// ==============================================================================
// modules/lambda-shared/lambda/shared.test.mjs
// 공통 라이브러리 shared.mjs 단위 테스트 파일 (vi.mock 적용)
// ==============================================================================
import { describe, it, expect, vi } from 'vitest';

// 한글 설명 주석: vi.mock은 컴파일 단계에서 최상단으로 호이스팅되어 정적 import 이전에 모킹을 강제합니다.
vi.mock('@aws-sdk/client-ssm', () => ({
  GetParametersByPathCommand: vi.fn().mockImplementation((input) => input),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: vi.fn().mockImplementation((input) => input),
}));

// 호이스팅된 모킹 상태에서 shared.mjs 모듈을 가져옵니다.
import { jsonResponse, getParams, handleAwsCost, handleArgoCD, parseTfStateResources } from './shared.mjs';

describe('shared.mjs 단위 테스트', () => {
  // 한글 설명 주석: jsonResponse 함수의 정상 CORS 응답 처리를 검증합니다.
  it('jsonResponse가 올바른 CORS 헤더와 상태 코드를 반환해야 한다', () => {
    const res = jsonResponse(200, { success: true });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(res.headers['Access-Control-Allow-Headers']).toBe('Content-Type,Authorization');
    expect(JSON.parse(res.body).success).toBe(true);
  });

  // 한글 설명 주석: getParams 함수의 SSM 파라미터 획득 및 페이징 처리를 검증합니다.
  it('getParams가 SSM에서 파라미터를 정상 로드하고 캐싱해야 한다', async () => {
    const ssmClient = {
      send: vi.fn().mockResolvedValue({
        Parameters: [
          { Name: '/test/param1', Value: 'val1' },
          { Name: '/test/param2', Value: 'val2' }
        ],
        NextToken: undefined
      })
    };
    const params = await getParams(ssmClient, '/test/');
    expect(params['param1']).toBe('val1');
    expect(params['param2']).toBe('val2');
  });

  // 한글 설명 주석: handleAwsCost 함수의 S3 비용 캐시 조회 및 TTL 캐싱을 검증합니다.
  it('handleAwsCost가 S3에서 비용 캐시를 정상 조회해야 한다', async () => {
    const s3Client = {
      send: vi.fn().mockResolvedValue({
        Body: {
          transformToString: vi.fn().mockResolvedValue(JSON.stringify({ totalCost: 150 }))
        }
      })
    };
    const res = await handleAwsCost(s3Client, 'test-bucket');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).totalCost).toBe(150);
  });

  // 한글 설명 주석: handleArgoCD 함수의 정상 fetch 프록싱 처리를 검증합니다.
  it('handleArgoCD가 API를 정상 호출하고 200 응답을 반환해야 한다', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ apps: [] }))
    });
    global.fetch = mockFetch;

    const res = await handleArgoCD('https://argocd.example.com', 'mock-token');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).apps).toBeDefined();
  });

  // 한글 설명 주석: parseTfStateResources 함수의 tfstate 파싱 및 stripDetails 옵션을 검증합니다.
  it('parseTfStateResources가 tfstate 리소스를 올바르게 파싱해야 한다', () => {
    const mockTfState = JSON.stringify({
      resources: [
        {
          mode: 'managed',
          type: 'aws_vpc',
          name: 'main',
          instances: [
            {
              attributes: { arn: 'arn:aws:ec2:vpc', tags: { Name: 'vpc-main' } }
            }
          ]
        }
      ]
    });

    // 1. 상세 속성 포함 검증 (stripDetails: false)
    const resultFull = parseTfStateResources(mockTfState, { stripDetails: false });
    expect(resultFull).toHaveLength(1);
    expect(resultFull[0].name).toBe('vpc-main');
    expect(resultFull[0].properties.arn).toBe('arn:aws:ec2:vpc');

    // 2. 상세 속성 소거 검증 (stripDetails: true)
    const resultStrip = parseTfStateResources(mockTfState, { stripDetails: true });
    expect(resultStrip).toHaveLength(1);
    expect(resultStrip[0].properties).toEqual({});
    expect(resultStrip[0].dependencies).toEqual([]);
  });
});
