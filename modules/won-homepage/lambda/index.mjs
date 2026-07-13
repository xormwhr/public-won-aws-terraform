// ==============================================================================
// 파일명: index.mjs
// 경로: modules/won-homepage/lambda/index.mjs
// 설명: GitHub Actions 및 SonarQube API Proxy 처리를 수행하는 통합 Lambda 핸들러
// ==============================================================================

import { SSMClient } from "@aws-sdk/client-ssm";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { jsonResponse, getParams, handleAwsCost, handleArgoCD, parseTfStateResources } from "./shared.mjs";

// AWS SDK SSM 클라이언트 생성
const ssmClient = new SSMClient({});
const s3Client = new S3Client({ region: "ap-northeast-2" });

// 한글 설명 주석: 공통 getParams에 ssmClient와 prefix를 주입하는 래퍼 함수입니다.
async function getParamsWrapper() {
  return await getParams(ssmClient, process.env.SSM_PREFIX || "/won-homepage/");
}

// jsonResponse 헬퍼 함수는 shared.mjs의 jsonResponse를 사용합니다.

/**
 * 람다 진입 이벤트 핸들러 함수
 */
export async function handler(event) {
  // CORS HTTP OPTIONS 예비요청(Preflight) 우선 처리
  if (event.requestContext?.http?.method === "OPTIONS") {
    return jsonResponse(200, "");
  }

  const params = await getParamsWrapper();
  const path = event.rawPath || "/";
  const qs = new URLSearchParams(event.rawQueryString || "");

  try {
    // 1. GitHub Actions API 라우팅 처리
    if (path.startsWith("/api/github")) {
      return await handleGitHub(path, qs, params);
    }
    
    // 2. SonarQube API 라우팅 처리 (경로 기반 매핑 지원을 위해 path를 전달)
    if (path.startsWith("/api/sonarqube")) {
      return await handleSonarQube(path, qs, params);
    }

    // 2-1. ArgoCD API 라우팅 처리
    if (path.startsWith("/api/argocd")) {
      return await handleArgoCD(params["argocd-url"], params["argocd-token"], { errorType: 'homepage' });
    }

    // 2-2. AWS 비용 모니터링 API 라우팅 처리
    if (path.startsWith("/api/aws-cost")) {
      return await handleAwsCost(s3Client, process.env.S3_BUCKET_NAME || `your-project-cost-cache-${process.env.ENVIRONMENT || "main"}`);
    }

    // 2-3. AWS 리소스 모니터링 API 라우팅 처리
    if (path.startsWith("/api/aws-resources")) {
      return await handleAwsResources(qs, params);
    }

    // 3. API 헬스 체크 대상 엔드포인트 목록 조회 (GET 전용)
    if (path.startsWith("/api/config/api-endpoints")) {
      return await handleConfigEndpoints(params);
    }

    // 4. 모니터링 대상 GitHub 리포지토리 목록 조회 (GET 전용)
    if (path.startsWith("/api/config/github-repos")) {
      return await handleConfigGithubRepos(params);
    }

    // 5. Lambda Proxy를 통한 헬스체크 대리 조회 API (GET 전용)
    if (path.startsWith("/api/proxy-health")) {
      return await handleProxyHealth(qs);
    }

    // 일치하는 API가 없을 때 S3 에러 핸들러 간섭 우회를 위해 200 응답 래핑 리턴
    return jsonResponse(200, { error: "존재하지 않는 프록시 엔드포인트 경로", path });
  } catch (err) {
    console.error("[Handler] 예외 처리 래핑:", err.message);
    return jsonResponse(200, { error: err.message });
  }
}

/**
 * GitHub Actions API 연동 프록싱 로직
 */
async function handleGitHub(path, qs, params) {
  const token = params["github-token"];
  const owner = params["github-owner"];

  // 1. 쿼리 스트링 또는 경로 파라미터(/api/github/repo/{repoName}.json)에서 repo 명을 추출합니다.
  let repo = qs.get("repo");
  const repoPathPrefix = "/api/github/repo/";

  if (!repo && path.startsWith(repoPathPrefix)) {
    const matches = path.match(/^\/api\/github\/repo\/(.+)\.json$/);
    if (matches) {
      repo = decodeURIComponent(matches[1]);
    }
  }

  if (!token || !owner) {
    return jsonResponse(200, { error: "GITHUB_ENV_NOT_SET" });
  }

  // repo 쿼리 파라미터 유무에 따른 동적 타겟 API 설정
  const endpoint = repo
    ? `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=10`
    : `https://api.github.com/users/${owner}/repos?per_page=30&sort=updated`;

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "won-homepage-lambda-proxy"
  };

  const res = await fetch(endpoint, { headers });
  const text = await res.text();

  if (!res.ok) {
    return jsonResponse(200, {
      error: `GitHub 연동 대상 서버 에러 발생 (HTTP ${res.status})`,
      details: text
    });
  }

  return jsonResponse(200, text);
}

/**
 * SonarQube 분석 지표 API 연동 프록싱 로직
 * 쿼리 파라미터 기반 호출(?action=...) 및 정적 경로 기반 호출(/api/sonarqube/...)을 모두 수용합니다.
 */
async function handleSonarQube(path, qs, params) {
  // AWS SSM Parameter Store에서 로드한 변수 획득
  const token = params["sonarqube-token"];
  let url = params["sonarqube-url"];
  
  // SSM 저장 오류 혹은 "undefined" 문자열 유입 시 자가 치유 폴백
  if (!url || url === "undefined") {
    url = "https://sonarqube.example.com";
  }

  const projectsEnv = params["sonarqube-projects"];
  const action = qs.get("action");
  const projectKey = qs.get("projectKey");

  if (!url || !token) {
    return jsonResponse(200, { error: "SONARQUBE_ENV_NOT_SET" });
  }

  // HTTP Basic 인증 구성을 위한 Base64 헤더 인코딩 (SonarQube 보안 요구 사양)
  const headers = {
    "Authorization": `Basic ${Buffer.from(token + ":").toString("base64")}`,
    "Content-Type": "application/json"
  };

  // 1. 프로젝트 리스트 반환 액션 (경로 "/api/sonarqube/projects.json" 또는 action === "projects")
  if (action === "projects" || path === "/api/sonarqube/projects.json") {
    const projects = projectsEnv ? JSON.parse(projectsEnv) : [];
    return jsonResponse(200, { projects });
  }

  // 2. 프로젝트 상세 품질 게이트 및 측정 메트릭 정보 액션
  // 경로 "/api/sonarqube/metrics/{projectKey}.json" 또는 쿼리스트링 action === "metrics" & projectKey 대응
  let targetProjectKey = projectKey;
  const metricsPathPrefix = "/api/sonarqube/metrics/";

  if (!targetProjectKey && path.startsWith(metricsPathPrefix)) {
    const matches = path.match(/^\/api\/sonarqube\/metrics\/(.+)\.json$/);
    if (matches) {
      targetProjectKey = decodeURIComponent(matches[1]);
    }
  }

  if ((action === "metrics" || path.startsWith(metricsPathPrefix)) && targetProjectKey) {
    const metricsUrl = `${url}/api/measures/component?component=${encodeURIComponent(targetProjectKey)}&metricKeys=bugs,vulnerabilities,code_smells,coverage,duplicated_lines_density,security_hotspots,reliability_rating,security_rating,sqale_rating,security_review_rating,lines_to_cover,ncloc`;
    const gateUrl = `${url}/api/qualitygates/project_status?projectKey=${encodeURIComponent(targetProjectKey)}`;

    const [metricsRes, gateRes] = await Promise.all([
      fetch(metricsUrl, { headers }),
      fetch(gateUrl, { headers })
    ]);

    const metricsText = await metricsRes.text();
    const gateText = await gateRes.text();

    if (!metricsRes.ok || !gateRes.ok) {
      return jsonResponse(200, {
        error: "SonarQube 원본 서버로부터 지표 데이터를 획득하는 과정에서 실패했습니다.",
        metricsStatus: metricsRes.status,
        gateStatus: gateRes.status
      });
    }

    return jsonResponse(200, {
      metrics: JSON.parse(metricsText),
      gate: JSON.parse(gateText)
    });
  }

  return jsonResponse(200, { error: "유효하지 않은 action 호출이거나 projectKey 쿼리스트링이 유실되었습니다." });
}

// ArgoCD API 프록시 기능은 shared.mjs의 handleArgoCD를 사용합니다.

/**
 * API 헬스 체크 대상 엔드포인트 목록 조회 프록시 (GET 전용)
 * AWS SSM Parameter Store의 '/won-homepage/api-endpoints' 설정값을 파싱하여 반환합니다.
 */
async function handleConfigEndpoints(params) {
  let endpoints = [];
  try {
    // SSM Parameter Store에서 읽어온 JSON 형식의 엔드포인트 목록을 파싱
    endpoints = JSON.parse(params["api-endpoints"] || "[]");
  } catch (err) {
    console.error("[ConfigEndpoints] JSON 파싱 에러:", err.message);
    endpoints = [];
  }
  return jsonResponse(200, endpoints);
}

/**
 * 모니터링할 GitHub 리포지토리 목록 조회 프록시 (GET 전용)
 * AWS SSM Parameter Store의 '/won-homepage/github-repos' 설정값을 파싱하여 반환합니다.
 */
async function handleConfigGithubRepos(params) {
  let repos = [];
  try {
    // SSM Parameter Store에서 읽어온 JSON 형식의 깃허브 리포지토리 목록을 파싱
    repos = JSON.parse(params["github-repos"] || "[]");
  } catch (err) {
    console.error("[ConfigGithubRepos] JSON 파싱 에러:", err.message);
    repos = [];
  }
  return jsonResponse(200, repos);
}

/**
 * 외부 API 헬스체크 요청을 Lambda 단에서 대신 수행하여 브라우저 CORS 정책을 우회하기 위한 프록시 함수
 * 쿼리 스트링으로 전달받은 url 대상으로 GET 요청을 수행하며 타임아웃 및 예외 처리를 제공합니다.
 */
async function handleProxyHealth(qs) {
  const targetUrl = qs.get("url");
  if (!targetUrl) {
    return jsonResponse(200, { error: "대리 조회를 수행할 targetUrl(url) 쿼리 스트링 매개변수가 유실되었습니다." });
  }

  const start = Date.now();
  try {
    // 백엔드 환경에서 헬스체크 대상 API를 직접 fetch 호출 (CORS 제약 해소)
    const res = await fetch(targetUrl, {
      method: "GET",
      // 무한 대기를 방지하기 위해 5초의 타임아웃을 설정
      signal: AbortSignal.timeout(5000)
    });
    
    const elapsed = Date.now() - start;
    
    // 정상적으로 응답을 획득한 경우 상태 정보를 반환
    return jsonResponse(200, {
      status: res.ok ? "ok" : "error",
      code: res.status,
      ms: elapsed
    });
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`[ProxyHealth] 타겟 대행 헬스체크 실패 (${targetUrl}):`, err.message);
    return jsonResponse(200, {
      status: "error",
      error: `대리 조회 실패: ${err.message}`,
      ms: elapsed
    });
  }
}
// AWS 비용 API 프록시 기능은 shared.mjs의 handleAwsCost를 사용합니다.

function getResourceProject(res) {
  if (!res) return "common";
  const idStr = res.id || "";
  const descStr = res.description || "";

  const PROJECTS = ["blog", "secret", "dashboard", "homepage", "outline", "cognito", "backend"];

  const moduleMatch = /^\[module\.([^\]]+)\]/.exec(descStr);
  if (moduleMatch) {
    const modulePath = moduleMatch[1].toLowerCase();
    const matched = PROJECTS.find(p => modulePath.includes(p));
    if (matched) return matched;
  }

  if (idStr.startsWith("module_")) {
    const idLower = idStr.toLowerCase();
    const matched = PROJECTS.find(p => idLower.includes(p));
    if (matched) return matched;
  }

  const checkStr = `${idStr} ${res.name || ""} ${descStr}`.toLowerCase();
  if (checkStr.includes("appsync")) return "blog";
  if (checkStr.includes("kms")) return "secret";
  if (checkStr.includes("tf_backend")) return "backend";

  const matched = PROJECTS.find(p => checkStr.includes(p));
  if (matched) return matched;

  return "common";
}

// tfstate 리소스 파싱 관련 헬퍼 함수는 shared.mjs의 parseTfStateResources를 사용합니다.

// AWS 리소스 모니터링 API 캐시 설정
let cachedResources = null;
let resourcesCacheExpiry = 0;

// 한글 설명 주석: S3 버킷에서 terraform.tfstate 파일을 비동기로 조회하고, 메모리 캐시(5분)를 적용하여 정제 결과를 응답하는 핸들러입니다.
async function handleAwsResources(qs, params) {
  const now = Date.now();
  const forceRefresh = qs.get("refresh") === "true";

  if (cachedResources && now < resourcesCacheExpiry && !forceRefresh) {
    console.log("[AWS-Resources] 캐싱된 테라폼 리소스 데이터를 반환합니다.");
    return jsonResponse(200, cachedResources);
  }

  const accessKeyId = params["aws-resources-access-key-id"];
  const secretAccessKey = params["aws-resources-secret-access-key"];
  const region = params["aws-resources-region"] || "ap-northeast-2";
  const bucket = params["aws-resources-s3-bucket"] || "your-terraform-state-bucket";
  const key = params["aws-resources-s3-key"] || "infrastructure/terraform.tfstate";

  if (!accessKeyId || !secretAccessKey) {
    return jsonResponse(200, { error: "AWS_RESOURCES_ENV_NOT_SET" });
  }

  try {
    const s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });

    const response = await s3Client.send(command);
    const stateContent = await response.Body.transformToString();
    // 한글 설명 주석: 보안 요구사항 준수 - stripDetails: true 옵션을 전달하여 속성을 소거합니다.
    const resources = parseTfStateResources(stateContent, { stripDetails: true });

    cachedResources = resources;
    resourcesCacheExpiry = now + 5 * 60 * 1000; // 5분 캐시

    return jsonResponse(200, resources);
  } catch (err) {
    console.error("[AWS-Resources] 에러 발생:", err.message);
    return jsonResponse(200, { error: `AWS 리소스 조회 실패: ${err.message}` });
  }
}


