// ==============================================================================
// modules/won-homepage/lambda/index.test.mjs
// won-homepage Lambda 핸들러 단위 테스트
// vi.doMock() + vi.resetModules() 패턴으로 모듈 레벨 초기화 문제 해결
// ==============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==============================================================================
// 모킹 헬퍼 함수
// ==============================================================================

/**
 * SSM, S3 클라이언트를 모킹하고 handler를 동적으로 임포트합니다.
 * Lambda 모듈은 모듈 레벨에서 new SSMClient({})를 실행하므로
 * 각 테스트마다 vi.resetModules()로 모듈을 재로드해야 합니다.
 */
async function setupHandler({ ssmSend, s3Send = vi.fn(), fetchImpl } = {}) {
  vi.resetModules();

  if (fetchImpl) {
    global.fetch = fetchImpl;
  } else {
    global.fetch = vi.fn();
  }

  vi.doMock('@aws-sdk/client-ssm', () => ({
    SSMClient: vi.fn().mockImplementation(() => ({ send: ssmSend || vi.fn() })),
    GetParametersByPathCommand: vi.fn().mockImplementation((input) => input),
  }));

  vi.doMock('@aws-sdk/client-s3', () => ({
    S3Client: vi.fn().mockImplementation(() => ({ send: s3Send })),
    GetObjectCommand: vi.fn().mockImplementation((input) => input),
  }));

  const { handler } = await import('./index.mjs');
  return handler;
}

/**
 * SSM 파라미터 배열을 생성하는 헬퍼
 * @param {Object} paramMap - { key: value } 형식
 * @param {string} prefix - SSM 경로 접두사
 */
function makeSsmParams(paramMap = {}, prefix = '/won-homepage/') {
  return {
    Parameters: Object.entries(paramMap).map(([key, value]) => ({
      Name: `${prefix}${key}`,
      Value: value,
    })),
    NextToken: undefined,
  };
}

/**
 * API Gateway HTTP API 이벤트 객체 생성 헬퍼
 */
function makeEvent(override = {}) {
  return {
    rawPath: '/',
    rawQueryString: '',
    requestContext: { http: { method: 'GET' } },
    headers: {},
    ...override,
  };
}

afterEach(() => {
  vi.resetModules();
});

// ==============================================================================
// OPTIONS preflight 처리
// ==============================================================================

describe('handler - OPTIONS preflight 처리', () => {
  it('OPTIONS 메서드 요청 시 200 응답을 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({
      requestContext: { http: { method: 'OPTIONS' } },
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
  });
});

// ==============================================================================
// 라우팅 - 알 수 없는 경로
// ==============================================================================

describe('handler - 라우팅', () => {
  it('존재하지 않는 경로 요청 시 200 + error를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/nonexistent' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.error).toBeDefined();
    expect(body.path).toBe('/nonexistent');
  });

  it('/api/github 경로는 handleGitHub로 라우팅 - 파라미터 없으면 에러 반환', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/github' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('GITHUB_ENV_NOT_SET');
  });

  it('/api/sonarqube 경로는 handleSonarQube로 라우팅 - 파라미터 없으면 에러 반환', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/sonarqube' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('SONARQUBE_ENV_NOT_SET');
  });

  it('/api/argocd 경로는 handleArgoCD로 라우팅 - 파라미터 없으면 에러 반환', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/argocd' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('ARGOCD_ENV_NOT_SET');
  });

  it('/api/config/api-endpoints 경로는 빈 배열을 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/config/api-endpoints' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(Array.isArray(body)).toBe(true);
  });

  it('/api/config/github-repos 경로는 빈 배열을 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/config/github-repos' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(Array.isArray(body)).toBe(true);
  });

  it('/api/proxy-health 경로에 url 없으면 에러를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/proxy-health', rawQueryString: '' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.error).toBeDefined();
  });

  it('/api/aws-resources 경로 요청 - 자격증명 없으면 에러 반환', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/aws-resources' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('AWS_RESOURCES_ENV_NOT_SET');
  });
});

// ==============================================================================
// GitHub 프록시
// ==============================================================================

describe('handler - GitHub 프록시 (/api/github)', () => {
  it('repo 없으면 사용자 repos API를 호출해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'github-token': 'test-token', 'github-owner': 'test-owner' })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify([{ name: 'repo1' }])),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({ rawPath: '/api/github' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://api.github.com/users/test-owner/repos'),
      expect.any(Object)
    );
  });

  it('repo 파라미터 있으면 Actions runs API를 호출해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'github-token': 'test-token', 'github-owner': 'test-owner' })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ workflow_runs: [] })),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({ rawPath: '/api/github', rawQueryString: 'repo=my-repo' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('repos/test-owner/my-repo/actions/runs'),
      expect.any(Object)
    );
  });

  it('GitHub API 에러 응답 시 에러 메시지를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'github-token': 'test-token', 'github-owner': 'test-owner' })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: vi.fn().mockResolvedValue('Forbidden'),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({ rawPath: '/api/github' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('GitHub 연동 대상 서버 에러');
  });

  it('/api/github/repo/{name}.json 경로에서 repo 이름을 추출해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'github-token': 'test-token', 'github-owner': 'test-owner' })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{}'),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({ rawPath: '/api/github/repo/my-special-repo.json' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('repos/test-owner/my-special-repo/actions/runs'),
      expect.any(Object)
    );
  });
});

// ==============================================================================
// SonarQube 프록시
// ==============================================================================

describe('handler - SonarQube 프록시 (/api/sonarqube)', () => {
  it('action=projects 요청 시 프로젝트 목록을 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({
        'sonarqube-token': 'sq_token',
        'sonarqube-url': 'https://sonarqube.example.com',
        'sonarqube-projects': '["project1"]',
      })
    );
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/sonarqube', rawQueryString: 'action=projects' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.projects).toEqual(['project1']);
  });

  it('/api/sonarqube/projects.json 경로에서 프로젝트 목록을 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({
        'sonarqube-token': 'sq_token',
        'sonarqube-url': 'https://sonarqube.example.com',
        'sonarqube-projects': '["project1"]',
      })
    );
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/sonarqube/projects.json' });
    const result = await handler(event);

    const body = JSON.parse(result.body);
    expect(body.projects).toEqual(['project1']);
  });

  it('action=metrics + projectKey 요청 시 SonarQube API를 두 번 호출해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({
        'sonarqube-token': 'sq_token',
        'sonarqube-url': 'https://sonarqube.example.com',
      })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{}'),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({
      rawPath: '/api/sonarqube',
      rawQueryString: 'action=metrics&projectKey=my-project',
    });
    await handler(event);

    // metrics + quality gate = 2번 호출
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sonarqube-url이 "undefined" 문자열이면 기본 URL로 폴백해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({
        'sonarqube-token': 'sq_token',
        'sonarqube-url': 'undefined',
      })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{}'),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({
      rawPath: '/api/sonarqube',
      rawQueryString: 'action=metrics&projectKey=my-project',
    });
    await handler(event);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('sonarqube.example.com'),
      expect.any(Object)
    );
  });

  it('잘못된 action 요청 시 에러를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'sonarqube-token': 'sq_token', 'sonarqube-url': 'https://sq.example.com' })
    );
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({
      rawPath: '/api/sonarqube',
      rawQueryString: 'action=unknown',
    });
    const result = await handler(event);

    const body = JSON.parse(result.body);
    expect(body.error).toBeDefined();
  });
});

// ==============================================================================
// ArgoCD 프록시
// ==============================================================================

describe('handler - ArgoCD 프록시 (/api/argocd)', () => {
  it('ArgoCD API 호출 성공 시 applications 목록을 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({
        'argocd-token': 'argo-token',
        'argocd-url': 'https://argocd.example.com',
      })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ items: [] })),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({ rawPath: '/api/argocd' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('argocd.example.com/api/v1/applications'),
      expect.any(Object)
    );
  });

  it('ArgoCD API 에러 응답 시 에러 메시지를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({
        'argocd-token': 'argo-token',
        'argocd-url': 'https://argocd.example.com',
      })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue('Unauthorized'),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({ rawPath: '/api/argocd' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('ArgoCD 연동 대상 서버 에러');
  });
});

// ==============================================================================
// Proxy Health
// ==============================================================================

describe('handler - Proxy Health (/api/proxy-health)', () => {
  it('타겟 URL 헬스체크 성공 시 ok 상태를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({
      rawPath: '/api/proxy-health',
      rawQueryString: 'url=https://example.com/health',
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('ok');
    expect(body.code).toBe(200);
    expect(typeof body.ms).toBe('number');
  });

  it('타겟 URL 헬스체크 실패 시 error 상태를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({
      rawPath: '/api/proxy-health',
      rawQueryString: 'url=https://down.example.com',
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('error');
    expect(body.code).toBe(503);
  });

  it('타겟 URL fetch 예외 발생 시 error 상태를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({
      rawPath: '/api/proxy-health',
      rawQueryString: 'url=https://unreachable.example.com',
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('error');
    expect(body.error).toContain('대리 조회 실패');
  });
});

// ==============================================================================
// SSM 파라미터 페이징 처리
// ==============================================================================

describe('SSM 파라미터 페이징 처리', () => {
  it('NextToken이 있으면 다음 페이지를 계속 조회해야 한다', async () => {
    const ssmSend = vi.fn()
      .mockResolvedValueOnce({
        Parameters: [{ Name: '/won-homepage/param1', Value: 'value1' }],
        NextToken: 'next-page-token',
      })
      .mockResolvedValueOnce({
        Parameters: [{ Name: '/won-homepage/param2', Value: 'value2' }],
        NextToken: undefined,
      });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/config/api-endpoints' });
    await handler(event);

    // SSM send가 2번 호출 (페이징 처리)
    expect(ssmSend).toHaveBeenCalledTimes(2);
  });

  it('SSM 조회 실패 시 빈 파라미터로 폴백해야 한다', async () => {
    const ssmSend = vi.fn().mockRejectedValue(new Error('SSM connection refused'));
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/config/api-endpoints' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
  });
});

// ==============================================================================
// AWS Resources 파싱
// ==============================================================================

describe('handler - AWS 리소스 파싱 (/api/aws-resources)', () => {
  it('tfstate에서 managed 리소스만 파싱하여 배열로 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({
        'aws-resources-access-key-id': 'AKIATEST',
        'aws-resources-secret-access-key': 'secret123',
        'aws-resources-region': 'ap-northeast-2',
        'aws-resources-s3-bucket': 'test-bucket',
        'aws-resources-s3-key': 'infrastructure/terraform.tfstate',
      })
    );
    const tfstate = {
      resources: [
        {
          mode: 'managed',
          type: 'aws_s3_bucket',
          name: 'test-bucket',
          module: 'module.won_blog',
          instances: [{ attributes: { tags: { Name: 'won-blog-bucket' }, arn: 'arn:aws:s3:::test' } }],
        },
        {
          mode: 'data',
          type: 'aws_region',
          name: 'current',
          instances: [{}],
        },
      ],
    };
    const s3Send = vi.fn().mockResolvedValue({
      Body: { transformToString: vi.fn().mockResolvedValue(JSON.stringify(tfstate)) },
    });
    const handler = await setupHandler({ ssmSend, s3Send });

    const event = makeEvent({ rawPath: '/api/aws-resources' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(Array.isArray(body)).toBe(true);
    // managed 리소스 1개 (data는 제외)
    expect(body.length).toBe(1);
  });

  it('S3 Bucket 타입이 "S3 Bucket"으로 변환되어야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({
        'aws-resources-access-key-id': 'AKIATEST',
        'aws-resources-secret-access-key': 'secret123',
      })
    );
    const tfstate = {
      resources: [
        {
          mode: 'managed',
          type: 'aws_s3_bucket',
          name: 'mybucket',
          instances: [{ attributes: { tags: { Name: 'my-bucket' } } }],
        },
      ],
    };
    const s3Send = vi.fn().mockResolvedValue({
      Body: { transformToString: vi.fn().mockResolvedValue(JSON.stringify(tfstate)) },
    });
    const handler = await setupHandler({ ssmSend, s3Send });

    const event = makeEvent({ rawPath: '/api/aws-resources' });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body[0].type).toBe('S3 Bucket');
  });

  it('S3 호출 실패 시 에러를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({
        'aws-resources-access-key-id': 'AKIATEST',
        'aws-resources-secret-access-key': 'secret123',
      })
    );
    const s3Send = vi.fn().mockRejectedValue(new Error('NoSuchKey'));
    const handler = await setupHandler({ ssmSend, s3Send });

    const event = makeEvent({ rawPath: '/api/aws-resources' });
    const result = await handler(event);

    const body = JSON.parse(result.body);
    expect(body.error).toBeDefined();
  });
});

// ==============================================================================
// AWS 비용 캐시
// ==============================================================================

describe('handler - AWS 비용 API (/api/aws-cost)', () => {
  it('S3에서 비용 데이터를 정상 조회해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const costData = { monthly: [], services: [] };
    const s3Send = vi.fn().mockResolvedValue({
      Body: { transformToString: vi.fn().mockResolvedValue(JSON.stringify(costData)) },
    });
    process.env.S3_BUCKET_NAME = 'test-cost-bucket';
    const handler = await setupHandler({ ssmSend, s3Send });

    const event = makeEvent({ rawPath: '/api/aws-cost' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    delete process.env.S3_BUCKET_NAME;
  });

  it('S3 조회 실패 시 에러를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const s3Send = vi.fn().mockRejectedValue(new Error('Access denied'));
    const handler = await setupHandler({ ssmSend, s3Send });

    const event = makeEvent({ rawPath: '/api/aws-cost' });
    const result = await handler(event);

    const body = JSON.parse(result.body);
    expect(body.error).toBeDefined();
  });
});
