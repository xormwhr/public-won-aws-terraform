// ==============================================================================
// modules/won-dashboard/lambda/index.test.mjs
// won-dashboard Lambda 핸들러 단위 테스트
// vi.doMock() + vi.resetModules() 패턴으로 모듈 레벨 초기화 문제 해결
// ==============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==============================================================================
// 모킹 헬퍼 함수
// ==============================================================================

/**
 * 각 테스트마다 모듈을 재로드하여 모듈 레벨 클라이언트 초기화 문제를 해결합니다.
 */
async function setupHandler({ ssmSend, ddbSend, s3Send = vi.fn(), fetchImpl } = {}) {
  vi.resetModules();

  if (fetchImpl) {
    global.fetch = fetchImpl;
  } else {
    global.fetch = vi.fn();
  }

  vi.doMock('@aws-sdk/client-ssm', () => ({
    SSMClient: vi.fn().mockImplementation(() => ({ send: ssmSend || vi.fn() })),
    GetParametersByPathCommand: vi.fn().mockImplementation((input) => input),
    PutParameterCommand: vi.fn().mockImplementation((input) => input),
  }));

  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn().mockImplementation(() => ({ send: ddbSend || vi.fn() })),
    GetItemCommand: vi.fn().mockImplementation((input) => input),
    PutItemCommand: vi.fn().mockImplementation((input) => input),
  }));

  vi.doMock('@aws-sdk/client-s3', () => ({
    S3Client: vi.fn().mockImplementation(() => ({ send: s3Send })),
    GetObjectCommand: vi.fn().mockImplementation((input) => input),
  }));

  const { handler } = await import('./index.mjs');
  return handler;
}

/**
 * SSM 파라미터 배열 생성 헬퍼
 */
function makeSsmParams(paramMap = {}, prefix = '/won-dashboard/') {
  return {
    Parameters: Object.entries(paramMap).map(([key, value]) => ({
      Name: `${prefix}${key}`,
      Value: value,
    })),
    NextToken: undefined,
  };
}

/**
 * API Gateway HTTP API 이벤트 생성 헬퍼
 */
function makeEvent(override = {}) {
  return {
    rawPath: '/',
    rawQueryString: '',
    requestContext: { http: { method: 'GET' } },
    headers: {},
    body: null,
    isBase64Encoded: false,
    ...override,
  };
}

afterEach(() => {
  vi.resetModules();
  delete process.env.DYNAMODB_BOOKMARKS_TABLE;
});

// ==============================================================================
// OPTIONS preflight 처리
// ==============================================================================

describe('handler - OPTIONS preflight 처리', () => {
  it('OPTIONS 메서드 요청 시 200 응답을 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ requestContext: { http: { method: 'OPTIONS' } } });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
  });
});

// ==============================================================================
// 존재하지 않는 경로
// ==============================================================================

describe('handler - 존재하지 않는 경로', () => {
  it('알 수 없는 경로 요청 시 200 + error 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/unknown-path' });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Not Found');
  });
});

// ==============================================================================
// GitHub 프록시
// ==============================================================================

describe('handler - GitHub 프록시 (/api/github/)', () => {
  it('owner 또는 repo 없으면 에러를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'github-token': 'test-token' })
    );
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({
      rawPath: '/api/github/runs',
      rawQueryString: 'owner=test-owner',
    });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('owner, repo 필수');
  });

  it('/api/github/runs 경로에서 GitHub Actions runs를 조회해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'github-token': 'test-token' })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ workflow_runs: [] })),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({
      rawPath: '/api/github/runs',
      rawQueryString: 'owner=test-owner&repo=test-repo',
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('repos/test-owner/test-repo/actions/runs'),
      expect.any(Object)
    );
  });

  it('/api/github/jobs 경로에서 runId 없으면 에러를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'github-token': 'test-token' })
    );
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({
      rawPath: '/api/github/jobs',
      rawQueryString: 'owner=test-owner&repo=test-repo',
    });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('runId 필수');
  });

  it('/api/github/jobs 경로에서 runId 있으면 jobs를 조회해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'github-token': 'test-token' })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ jobs: [] })),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({
      rawPath: '/api/github/jobs',
      rawQueryString: 'owner=test-owner&repo=test-repo&runId=12345',
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('actions/runs/12345/jobs'),
      expect.any(Object)
    );
  });

  it('알 수 없는 GitHub 경로 요청 시 Unknown endpoint 에러를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'github-token': 'test-token' })
    );
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({
      rawPath: '/api/github/unknown-endpoint',
      rawQueryString: 'owner=x&repo=y',
    });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Unknown endpoint');
  });

  it('GitHub API 에러 응답 시 에러 메시지를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'github-token': 'test-token' })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: vi.fn().mockResolvedValue('Forbidden'),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({
      rawPath: '/api/github/runs',
      rawQueryString: 'owner=test-owner&repo=test-repo',
    });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('GitHub API 오류');
    expect(body.upstreamStatus).toBe(403);
  });
});

// ==============================================================================
// SonarQube 프록시
// ==============================================================================

describe('handler - SonarQube 프록시 (/api/sonarqube/)', () => {
  it('project 파라미터 없으면 에러를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'sonarqube-token': 'sq_token', 'sonarqube-url': 'https://sq.example.com' })
    );
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/sonarqube/measures' });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('project 필수');
  });

  it('/api/sonarqube/measures 경로에서 metrics API를 호출해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'sonarqube-token': 'sq_token', 'sonarqube-url': 'https://sq.example.com' })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{}'),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({
      rawPath: '/api/sonarqube/measures',
      rawQueryString: 'project=my-project',
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/measures/component?component=my-project'),
      expect.any(Object)
    );
  });

  it('/api/sonarqube/quality-gate 경로에서 quality gate API를 호출해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'sonarqube-token': 'sq_token', 'sonarqube-url': 'https://sq.example.com' })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{}'),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({
      rawPath: '/api/sonarqube/quality-gate',
      rawQueryString: 'project=my-project',
    });
    await handler(event);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/qualitygates/project_status?projectKey=my-project'),
      expect.any(Object)
    );
  });

  it('sonarqube-url이 "undefined" 문자열이면 기본 URL로 폴백해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'sonarqube-token': 'sq_token', 'sonarqube-url': 'undefined' })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{}'),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({
      rawPath: '/api/sonarqube/measures',
      rawQueryString: 'project=my-project',
    });
    await handler(event);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('sonarqube.example.com'),
      expect.any(Object)
    );
  });

  it('SonarQube API 에러 응답 시 에러를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'sonarqube-token': 'sq_token', 'sonarqube-url': 'https://sq.example.com' })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue('Unauthorized'),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({
      rawPath: '/api/sonarqube/measures',
      rawQueryString: 'project=my-project',
    });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('SonarQube API 오류');
  });
});

// ==============================================================================
// ArgoCD 프록시
// ==============================================================================

describe('handler - ArgoCD 프록시 (/api/argocd/)', () => {
  it('argocd-url 또는 token 없으면 에러를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/argocd/apps' });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('ArgoCD URL 또는 API 토큰 설정 누락');
  });

  it('ArgoCD API 호출 성공 시 applications 목록을 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'argocd-token': 'argo-token', 'argocd-url': 'https://argocd.example.com' })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ items: [] })),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({ rawPath: '/api/argocd/apps' });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
  });

  it('ArgoCD API 에러 응답 시 에러를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'argocd-token': 'argo-token', 'argocd-url': 'https://argocd.example.com' })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({ rawPath: '/api/argocd/apps' });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('ArgoCD API 오류');
  });
});

// ==============================================================================
// API Health
// ==============================================================================

describe('handler - API Health (/api/health)', () => {
  it('api-endpoints 설정 없으면 빈 결과를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/health' });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('endpoint 헬스체크 성공 시 up 상태를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({
        'api-endpoints': JSON.stringify([{ label: 'Test API', url: 'https://test.example.com' }]),
      })
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({ rawPath: '/api/health' });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body[0].status).toBe('up');
    expect(body[0].label).toBe('Test API');
  });

  it('endpoint 헬스체크 실패 시 down 상태를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({
        'api-endpoints': JSON.stringify([{ label: 'Down API', url: 'https://down.example.com' }]),
      })
    );
    const fetchMock = vi.fn().mockRejectedValue(new Error('Connection refused'));
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({ rawPath: '/api/health' });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body[0].status).toBe('down');
  });

  it('잘못된 api-endpoints JSON 설정 시 에러를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'api-endpoints': 'invalid-json' })
    );
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/health' });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.error).toBeDefined();
  });
});

// ==============================================================================
// Config Repos (GET/POST)
// ==============================================================================

describe('handler - Config Repos (/api/config/repos)', () => {
  it('GET 요청 시 github-repos 목록을 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'github-repos': JSON.stringify(['repo1', 'repo2']) })
    );
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/config/repos' });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body).toEqual(['repo1', 'repo2']);
  });

  it('GET 요청 시 github-repos 없으면 빈 배열을 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/config/repos' });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body).toEqual([]);
  });

  it('POST 요청 시 배열이 아닌 body 전송 시 400을 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({
      rawPath: '/api/config/repos',
      requestContext: { http: { method: 'POST' } },
      body: JSON.stringify({ invalid: 'not array' }),
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  it('POST 요청 시 repos 배열을 저장해야 한다', async () => {
    const ssmSend = vi.fn()
      .mockResolvedValueOnce({ Parameters: [], NextToken: undefined }) // getParams
      .mockResolvedValueOnce({}); // PutParameterCommand
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({
      rawPath: '/api/config/repos',
      requestContext: { http: { method: 'POST' } },
      body: JSON.stringify(['repo-a', 'repo-b']),
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
  });

  it('지원하지 않는 메서드 요청 시 405를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({
      rawPath: '/api/config/repos',
      requestContext: { http: { method: 'DELETE' } },
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(405);
  });
});

// ==============================================================================
// Config Endpoints (GET/POST)
// ==============================================================================

describe('handler - Config Endpoints (/api/config/endpoints)', () => {
  it('GET 요청 시 api-endpoints 목록을 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({
        'api-endpoints': JSON.stringify([{ label: 'API', url: 'https://api.example.com' }]),
      })
    );
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/config/endpoints' });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body[0].label).toBe('API');
  });

  it('POST 요청 시 label 또는 url 없으면 500을 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({
      rawPath: '/api/config/endpoints',
      requestContext: { http: { method: 'POST' } },
      body: JSON.stringify([{ label: 'Missing URL' }]),
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(500);
  });

  // 한글 설명 주석: POST 요청 시 body가 배열 형식이 아닐 때 parseAndValidateEndpoints가 TypeError를 던지고, 500 응답을 유발하는지 검증합니다.
  it('POST 요청 시 배열 형식이 아니면 500을 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({
      rawPath: '/api/config/endpoints',
      requestContext: { http: { method: 'POST' } },
      body: JSON.stringify({ label: 'Not an Array', url: 'https://not-array.com' }),
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(500);
  });

  it('POST 요청 시 유효한 endpoint 배열을 저장해야 한다', async () => {
    const ssmSend = vi.fn()
      .mockResolvedValueOnce({ Parameters: [], NextToken: undefined })
      .mockResolvedValueOnce({});
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({
      rawPath: '/api/config/endpoints',
      requestContext: { http: { method: 'POST' } },
      body: JSON.stringify([{ label: 'API', url: 'https://api.example.com' }]),
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
  });
});

// ==============================================================================
// Config SonarQube Projects (GET/POST)
// ==============================================================================

describe('handler - Config SonarQube Projects (/api/config/sonarqube-projects)', () => {
  it('GET 요청 시 sonarqube-projects 목록을 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'sonarqube-projects': JSON.stringify(['project-a']) })
    );
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/config/sonarqube-projects' });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body).toEqual(['project-a']);
  });

  it('POST 요청 시 배열이 아닌 body 전송 시 400을 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({
      rawPath: '/api/config/sonarqube-projects',
      requestContext: { http: { method: 'POST' } },
      body: JSON.stringify('not-array'),
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  it('POST 요청 시 projects 배열을 저장해야 한다', async () => {
    const ssmSend = vi.fn()
      .mockResolvedValueOnce({ Parameters: [], NextToken: undefined })
      .mockResolvedValueOnce({});
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({
      rawPath: '/api/config/sonarqube-projects',
      requestContext: { http: { method: 'POST' } },
      body: JSON.stringify(['my-project']),
    });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
  });
});

// ==============================================================================
// Bookmarks (GET/POST)
// ==============================================================================

describe('handler - Bookmarks (/api/bookmarks)', () => {
  it('DYNAMODB_BOOKMARKS_TABLE 없으면 500을 반환해야 한다', async () => {
    delete process.env.DYNAMODB_BOOKMARKS_TABLE;
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/bookmarks' });
    const result = await handler(event);
    expect(result.statusCode).toBe(500);
  });

  it('GET 요청 시 shared + personal 북마크를 반환해야 한다', async () => {
    process.env.DYNAMODB_BOOKMARKS_TABLE = 'test-bookmarks-table';
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });

    const sharedBookmarks = [{ id: '1', title: 'Shared', url: 'https://shared.com' }];
    const personalBookmarks = [{ id: '2', title: 'Personal', url: 'https://personal.com' }];
    const ddbSend = vi.fn()
      .mockResolvedValueOnce({ Item: { bookmarks: { S: JSON.stringify(sharedBookmarks) } } })
      .mockResolvedValueOnce({ Item: { bookmarks: { S: JSON.stringify(personalBookmarks) } } });

    const handler = await setupHandler({ ssmSend, ddbSend });

    const event = makeEvent({
      rawPath: '/api/bookmarks',
      headers: {
        authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0LXVzZXItaWQifQ.sig',
      },
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(Array.isArray(body.shared)).toBe(true);
    expect(Array.isArray(body.personal)).toBe(true);
    expect(body.shared[0].isShared).toBe(true);
    expect(body.personal[0].isShared).toBe(false);
  });

  it('POST 요청 시 북마크를 DynamoDB에 저장해야 한다', async () => {
    process.env.DYNAMODB_BOOKMARKS_TABLE = 'test-bookmarks-table';
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const ddbSend = vi.fn().mockResolvedValue({});
    const handler = await setupHandler({ ssmSend, ddbSend });

    const event = makeEvent({
      rawPath: '/api/bookmarks',
      requestContext: { http: { method: 'POST' } },
      body: JSON.stringify({
        type: 'personal',
        bookmarks: [{ id: '1', title: 'My Link', url: 'https://example.com' }],
      }),
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
  });

  it('지원하지 않는 메서드 요청 시 405를 반환해야 한다', async () => {
    process.env.DYNAMODB_BOOKMARKS_TABLE = 'test-bookmarks-table';
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({
      rawPath: '/api/bookmarks',
      requestContext: { http: { method: 'DELETE' } },
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(405);
  });
});

// ==============================================================================
// n8n Summarize 프록시
// ==============================================================================

describe('handler - n8n Summarize (/api/n8n/summarize)', () => {
  it('GET 요청 시 405를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const handler = await setupHandler({ ssmSend });

    const event = makeEvent({ rawPath: '/api/n8n/summarize' });
    const result = await handler(event);
    expect(result.statusCode).toBe(405);
  });

  it('POST 요청 시 n8n webhook을 호출해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue(
      makeSsmParams({ 'n8n-summarize-webhook-url': 'https://n8n.example.com/webhook/test' })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('요약 완료'),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({
      rawPath: '/api/n8n/summarize',
      requestContext: { http: { method: 'POST' } },
      body: JSON.stringify({ content: '요약할 내용' }),
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://n8n.example.com/webhook/test',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('n8n webhook 에러 응답 시 에러 정보를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    });
    const handler = await setupHandler({ ssmSend, fetchImpl: fetchMock });

    const event = makeEvent({
      rawPath: '/api/n8n/summarize',
      requestContext: { http: { method: 'POST' } },
      body: '{}',
    });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('n8n Webhook 오류');
  });
});

// ==============================================================================
// AWS Cost + AWS Resources
// ==============================================================================

describe('handler - AWS Cost (/api/aws-cost)', () => {
  it('S3에서 비용 데이터를 정상 조회해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const costData = { monthly: [], services: [] };
    process.env.S3_BUCKET_NAME = 'test-cost-bucket';
    const s3Send = vi.fn().mockResolvedValue({
      Body: { transformToString: vi.fn().mockResolvedValue(JSON.stringify(costData)) },
    });
    const handler = await setupHandler({ ssmSend, s3Send });

    const event = makeEvent({ rawPath: '/api/aws-cost' });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    delete process.env.S3_BUCKET_NAME;
  });

  it('S3 조회 실패 시 에러를 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const s3Send = vi.fn().mockRejectedValue(new Error('NoSuchBucket'));
    const handler = await setupHandler({ ssmSend, s3Send });

    const event = makeEvent({ rawPath: '/api/aws-cost' });
    const result = await handler(event);
    const body = JSON.parse(result.body);
    expect(body.error).toBeDefined();
  });
});

describe('handler - AWS Resources (/api/aws-resources)', () => {
  it('tfstate에서 리소스를 파싱하여 배열로 반환해야 한다', async () => {
    const ssmSend = vi.fn().mockResolvedValue({ Parameters: [], NextToken: undefined });
    const tfstate = {
      resources: [
        {
          mode: 'managed',
          type: 'aws_dynamodb_table',
          name: 'bookmarks',
          instances: [{ attributes: { tags: { Name: 'bookmarks-table' } } }],
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
    expect(body[0].type).toBe('DynamoDB');
  });
});
