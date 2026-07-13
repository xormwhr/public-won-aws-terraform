// your-project-name-terraform/modules/won-dashboard/lambda/index.mjs
import { SSMClient, PutParameterCommand } from "@aws-sdk/client-ssm";
import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { jsonResponse, getParams, setCachedParam, handleAwsCost, handleArgoCD, parseTfStateResources } from "./shared.mjs";

const ddbClient = new DynamoDBClient({});

// 한글 설명 주석: SSM 파라미터 로딩 캐시 처리를 위한 SSMClient 생성
const ssmClient = new SSMClient({});
const s3Client = new S3Client({ region: "ap-northeast-2" });

// 한글 설명 주석: 공통 getParams에 ssmClient와 prefix를 주입하는 래퍼 함수입니다.
async function getParamsWrapper() {
  return await getParams(ssmClient, process.env.SSM_PREFIX || "/won-dashboard/");
}

// 메인 핸들러
export async function handler(event) {
  // OPTIONS preflight 처리
  if (event.requestContext?.http?.method === "OPTIONS") {
    return jsonResponse(200, "");
  }

  const params = await getParamsWrapper();
  const path = event.rawPath || "/";
  const qs = new URLSearchParams(event.rawQueryString || "");
  const method = event.requestContext?.http?.method || "GET";

  try {
    if (path.startsWith("/api/config/repos")) return await handleConfigRepos(method, event, params);
    if (path.startsWith("/api/config/endpoints")) return await handleConfigEndpoints(method, event, params);
    if (path.startsWith("/api/config/sonarqube-projects")) return await handleConfigSonarProjects(method, event, params);
    if (path.startsWith("/api/github/")) return await handleGitHub(path, qs, params);
    if (path.startsWith("/api/sonarqube/")) return await handleSonarQube(path, qs, params);
    if (path.startsWith("/api/argocd/")) return await handleArgoCD(params["argocd-url"], params["argocd-token"]);
    if (path.startsWith("/api/bookmarks")) return await handleBookmarks(method, event);
    if (path.startsWith("/api/n8n/summarize")) return await handleN8nSummarize(method, event, params);
    if (path.startsWith("/api/aws-cost")) return await handleAwsCost(s3Client, process.env.S3_BUCKET_NAME || "your-project-cost-cache-main");
    if (path.startsWith("/api/aws-resources")) return await handleAwsResources(qs, params);
    if (path === "/api/health") return await handleHealth(params);
    // CloudFront custom_error_response가 가로채지 않도록 200으로 응답
    return jsonResponse(200, { error: "Not Found", path });
  } catch (err) {
    console.error("[Handler] 처리 오류:", err.message, "path:", path);
    return jsonResponse(200, { error: err.message });
  }
}

// GitHub API 프록시
async function handleGitHub(path, qs, params) {
  const token = params["github-token"];
  const owner = qs.get("owner");
  const repo = qs.get("repo");
  // CloudFront custom_error_response 간섭 방지: 모든 에러를 200 + JSON body로 반환
  if (!owner || !repo) return jsonResponse(200, { error: "owner, repo 필수" });

  let apiPath;
  if (path === "/api/github/runs") {
    const q = new URLSearchParams();
    for (const k of ["per_page", "page", "status"]) {
      if (qs.get(k)) q.set(k, qs.get(k));
    }
    apiPath = `/repos/${owner}/${repo}/actions/runs${q.toString() ? "?" + q : ""}`;
  } else if (path === "/api/github/jobs") {
    const runId = qs.get("runId");
    if (!runId) return jsonResponse(200, { error: "runId 필수" });
    apiPath = `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`;
  } else {
    return jsonResponse(200, { error: "Unknown endpoint" });
  }

  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${apiPath}`, { headers });
  // 업스트림 상태 코드를 그대로 반환하면 CloudFront가 403/404를 index.html로 치환함
  // 항상 200으로 래핑하고, 에러 정보는 JSON body에 포함
  const upstream = await res.text();
  if (!res.ok) {
    return jsonResponse(200, {
      error: `GitHub API 오류 (HTTP ${res.status})`,
      upstreamStatus: res.status,
    });
  }
  return jsonResponse(200, upstream);
}

// SonarQube API 프록시
async function handleSonarQube(path, qs, params) {
  const token = params["sonarqube-token"];
  let sonarUrl = params["sonarqube-url"];
  
  // SSM 저장 오류 혹은 "undefined" 문자열 유입 시 자가 치유 폴백
  if (!sonarUrl || sonarUrl === "undefined") {
    sonarUrl = "https://sonarqube.example.com";
  }

  const project = qs.get("project");
  if (!project) return jsonResponse(200, { error: "project 필수" });

  let apiPath;
  if (path === "/api/sonarqube/measures") {
    const metrics = "bugs,vulnerabilities,code_smells,coverage,duplicated_lines_density,ncloc,lines,lines_to_cover,reliability_rating,security_rating,sqale_rating,security_review_rating,security_hotspots";
    apiPath = `/api/measures/component?component=${encodeURIComponent(project)}&metricKeys=${metrics}`;
  } else if (path === "/api/sonarqube/quality-gate") {
    apiPath = `/api/qualitygates/project_status?projectKey=${encodeURIComponent(project)}`;
  } else {
    return jsonResponse(200, { error: "Unknown endpoint" });
  }

  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Basic ${Buffer.from(token + ":").toString("base64")}`;
  const res = await fetch(`${sonarUrl}${apiPath}`, { headers });
  // 업스트림 상태 코드를 그대로 반환하면 CloudFront가 403/404를 index.html로 치환함
  const upstream = await res.text();
  if (!res.ok) {
    return jsonResponse(200, {
      error: `SonarQube API 오류 (HTTP ${res.status})`,
      upstreamStatus: res.status,
    });
  }
  return jsonResponse(200, upstream);
}

// ArgoCD API 프록시 기능은 shared.mjs의 handleArgoCD를 사용합니다.

// API Health 프록시
async function handleHealth(params) {
  let endpoints;
  try { endpoints = JSON.parse(params["api-endpoints"] || "[]"); }
  catch { return jsonResponse(200, { error: "잘못된 api-endpoints 설정" }); }

  const results = await Promise.all(endpoints.map(async (ep) => {
    const start = Date.now();
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(ep.url, { method: ep.method || "GET", signal: ctrl.signal });
      clearTimeout(tid);
      return { label: ep.label, status: res.ok ? "up" : "down", statusCode: res.status, responseMs: Date.now() - start, errorMsg: res.ok ? null : `HTTP ${res.status}` };
    } catch (err) {
      return { label: ep.label, status: "down", statusCode: null, responseMs: Date.now() - start, errorMsg: err.name === "AbortError" ? "타임아웃 (5초)" : "연결 실패" };
    }
  }));
  return jsonResponse(200, results);
}

// Config Repos 프록시
async function handleConfigRepos(method, event, params) {
  if (method === "GET") {
    let repos = [];
    try {
      repos = JSON.parse(params["github-repos"] || "[]");
    } catch {
      repos = [];
    }
    return jsonResponse(200, repos);
  }

  if (method === "POST") {
    try {
      let body;
      if (event.isBase64Encoded) {
        body = JSON.parse(Buffer.from(event.body, "base64").toString("utf-8"));
      } else {
        body = JSON.parse(event.body || "[]");
      }

      if (!Array.isArray(body)) {
        return jsonResponse(400, { error: "배열 형식이 필요합니다." });
      }

      const value = JSON.stringify(body);
      const prefix = process.env.SSM_PREFIX || "/won-dashboard/";
      const name = `${prefix}github-repos`;

      const cmd = new PutParameterCommand({
        Name: name,
        Value: value,
        Type: "String",
        Overwrite: true
      });
      await ssmClient.send(cmd);

      // 캐시 무효화
      setCachedParam("github-repos", value);

      return jsonResponse(200, { success: true });
    } catch (err) {
      console.error("[Config] Repos 업데이트 실패:", err.message);
      return jsonResponse(500, { error: err.message });
    }
  }

  return jsonResponse(405, { error: "Method Not Allowed" });
}

// Config SonarQube Projects 프록시
async function handleConfigSonarProjects(method, event, params) {
  if (method === "GET") {
    let projects = [];
    try {
      projects = JSON.parse(params["sonarqube-projects"] || "[]");
    } catch {
      projects = [];
    }
    return jsonResponse(200, projects);
  }

  if (method === "POST") {
    try {
      let body;
      if (event.isBase64Encoded) {
        body = JSON.parse(Buffer.from(event.body, "base64").toString("utf-8"));
      } else {
        body = JSON.parse(event.body || "[]");
      }

      if (!Array.isArray(body)) {
        return jsonResponse(400, { error: "배열 형식이 필요합니다." });
      }

      const value = JSON.stringify(body);
      const prefix = process.env.SSM_PREFIX || "/won-dashboard/";
      const name = `${prefix}sonarqube-projects`;

      const cmd = new PutParameterCommand({
        Name: name,
        Value: value,
        Type: "String",
        Overwrite: true
      });
      await ssmClient.send(cmd);

      // 캐시 무효화
      setCachedParam("sonarqube-projects", value);

      return jsonResponse(200, { success: true });
    } catch (err) {
      console.error("[Config] SonarQube Projects 업데이트 실패:", err.message);
      return jsonResponse(500, { error: err.message });
    }
  }

  return jsonResponse(405, { error: "Method Not Allowed" });
}

function parseAndValidateEndpoints(event) {
  let body;
  if (event.isBase64Encoded) {
    body = JSON.parse(Buffer.from(event.body, "base64").toString("utf-8"));
  } else {
    body = JSON.parse(event.body || "[]");
  }

  if (!Array.isArray(body)) {
    // 한글 설명 주석: 소나큐브 S7786 규칙에 대응하여, 배열 타입 체크 실패 시 일반 Error 대신 TypeError를 던지도록 수정합니다.
    throw new TypeError("배열 형식이 필요합니다.");
  }

  for (const ep of body) {
    if (!ep.label || !ep.url) {
      throw new Error("각 엔드포인트에 label과 url은 필수입니다.");
    }
  }
  return body;
}

// Config Endpoints 프록시 (API 헬스 체크 대상 엔드포인트 동적 관리)
// handleConfigRepos와 동일한 패턴: GET → SSM 읽기, POST → SSM 쓰기
async function handleConfigEndpoints(method, event, params) {
  if (method === "GET") {
    let endpoints = [];
    try {
      endpoints = JSON.parse(params["api-endpoints"] || "[]");
    } catch {
      endpoints = [];
    }
    return jsonResponse(200, endpoints);
  }

  if (method === "POST") {
    try {
      const body = parseAndValidateEndpoints(event);

      const value = JSON.stringify(body);
      const prefix = process.env.SSM_PREFIX || "/won-dashboard/";
      const name = `${prefix}api-endpoints`;

      const cmd = new PutParameterCommand({
        Name: name,
        Value: value,
        Type: "String",
        Overwrite: true
      });
      await ssmClient.send(cmd);

      // 캐시 무효화
      setCachedParam("api-endpoints", value);

      return jsonResponse(200, { success: true });
    } catch (err) {
      console.error("[Config] Endpoints 업데이트 실패:", err.message);
      return jsonResponse(500, { error: err.message });
    }
  }

  return jsonResponse(405, { error: "Method Not Allowed" });
}

function extractSubFromEvent(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return "anonymous";
  try {
    const payloadB64 = token.split(".")[1];
    const payloadStr = Buffer.from(payloadB64, "base64").toString("utf-8");
    const payload = JSON.parse(payloadStr);
    return payload.sub || "anonymous";
  } catch (e) {
    console.error("[Bookmarks] Token decode failed", e.message);
    return "anonymous";
  }
}

async function getBookmarks(sub, tableName) {
  // 병렬로 GLOBAL#SHARED와 USER#<sub_id> 조회
  const [sharedRes, personalRes] = await Promise.all([
    ddbClient.send(new GetItemCommand({
      TableName: tableName,
      Key: { id: { S: "GLOBAL#SHARED" } }
    })),
    ddbClient.send(new GetItemCommand({
      TableName: tableName,
      Key: { id: { S: `USER#${sub}` } }
    }))
  ]);

  let shared = [];
  let personal = [];
  if (sharedRes.Item?.bookmarks?.S) {
    shared = JSON.parse(sharedRes.Item.bookmarks.S);
  }
  if (personalRes.Item?.bookmarks?.S) {
    personal = JSON.parse(personalRes.Item.bookmarks.S);
  }
  
  // 공통 북마크에는 isShared: true 플래그 추가
  shared = shared.map(b => ({ ...b, isShared: true }));
  // 개인 북마크에는 isShared: false 플래그 추가
  personal = personal.map(b => ({ ...b, isShared: false }));

  return { shared, personal };
}

async function saveBookmarks(event, sub, tableName) {
  let body;
  if (event.isBase64Encoded) {
    body = JSON.parse(Buffer.from(event.body, "base64").toString("utf-8"));
  } else {
    body = JSON.parse(event.body || "{}");
  }

  const { type, bookmarks } = body;
  if (!type || !Array.isArray(bookmarks)) {
    throw new Error("type(shared/personal) 및 bookmarks 배열이 필요합니다.");
  }

  const pk = type === "shared" ? "GLOBAL#SHARED" : `USER#${sub}`;
  const value = JSON.stringify(bookmarks.map(b => {
    // isShared 필드는 저장 시 제거 (클라이언트에서 사용되는 파생 속성이므로)
    const { isShared, ...rest } = b;
    return rest;
  }));

  await ddbClient.send(new PutItemCommand({
    TableName: tableName,
    Item: {
      id: { S: pk },
      bookmarks: { S: value }
    }
  }));
}

// Bookmarks 프록시
async function handleBookmarks(method, event) {
  const tableName = process.env.DYNAMODB_BOOKMARKS_TABLE;
  if (!tableName) return jsonResponse(500, { error: "DYNAMODB_BOOKMARKS_TABLE not configured" });

  const sub = extractSubFromEvent(event);

  if (method === "GET") {
    try {
      const data = await getBookmarks(sub, tableName);
      return jsonResponse(200, data);
    } catch (err) {
      console.error("[Bookmarks] GET Error:", err);
      return jsonResponse(500, { error: err.message });
    }
  }

  if (method === "POST" || method === "PUT") {
    try {
      await saveBookmarks(event, sub, tableName);
      return jsonResponse(200, { success: true });
    } catch (err) {
      console.error("[Bookmarks] POST Error:", err);
      return jsonResponse(500, { error: err.message });
    }
  }

  return jsonResponse(405, { error: "Method Not Allowed" });
}

// n8n AI Summarizer 프록시
// POST /api/n8n/summarize → n8n Webhook (SSM: n8n-summarize-webhook-url)
async function handleN8nSummarize(method, event, params) {
  if (method !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  try {
    // SSM에서 Webhook URL 조회, 없으면 기본값 사용
    const webhookUrl = params["n8n-summarize-webhook-url"]
      || "https://n8n.example.com/webhook/summarize-post";

    // 요청 본문 디코딩 (Lambda Function URL은 base64로 인코딩할 수 있음)
    let body;
    if (event.isBase64Encoded) {
      body = Buffer.from(event.body, "base64").toString("utf-8");
    } else {
      body = event.body || "{}";
    }

    // n8n Webhook 호출 (25초 타임아웃 - Lambda 30초 제한 내)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    // 업스트림 상태 코드를 그대로 반환하면 CloudFront가 403/404를 index.html로 치환함
    // 항상 200으로 래핑하고, 에러 정보는 JSON body에 포함
    const upstream = await res.text();
    if (!res.ok) {
      return jsonResponse(200, {
        error: `n8n Webhook 오류 (HTTP ${res.status})`,
        upstreamStatus: res.status,
      });
    }

    return jsonResponse(200, upstream);
  } catch (err) {
    if (err.name === "AbortError") {
      return jsonResponse(200, { error: "n8n 요약 요청 시간이 초과되었습니다. (25초)" });
    }
    console.error("[N8N] Summarize 오류:", err.message);
    return jsonResponse(200, { error: err.message });
  }
}

// AWS 비용 API 프록시 기능은 shared.mjs의 handleAwsCost를 사용합니다.


// AWS 리소스 모니터링 API 캐시 설정
let cachedResources = null;
let resourcesCacheExpiry = 0;

// 한글 설명 주석: AWS 리소스 모니터링을 위한 S3 tfstate 조회 및 정제 핸들러입니다.
async function handleAwsResources(qs, params) {
  const now = Date.now();
  const forceRefresh = qs.get("refresh") === "true";

  if (cachedResources && now < resourcesCacheExpiry && !forceRefresh) {
    console.log("[AWS-Resources] 캐싱된 테라폼 리소스 데이터를 반환합니다.");
    return jsonResponse(200, cachedResources);
  }

  // tfstate 리소스 파싱 관련 헬퍼 함수는 shared.mjs의 parseTfStateResources를 사용합니다.
  const resBucket = params["aws-resources-s3-bucket"] || "your-terraform-state-bucket";
  const resKey = params["aws-resources-s3-key"] || "infrastructure/terraform.tfstate";
  const resRegion = params["aws-resources-region"] || "ap-northeast-2";

  try {
    console.log("[AWS-Resources] S3 버킷에서 tfstate 파일을 로드합니다. (Zero-Credential)");
    // 한글 설명 주석: Zero-Credential 방식. Lambda Execution Role의 S3 권한을 활용하므로 credentials를 생략합니다.
    const s3Client = new S3Client({ region: resRegion });

    const command = new GetObjectCommand({
      Bucket: resBucket,
      Key: resKey
    });

    const response = await s3Client.send(command);
    const stateContent = await response.Body.transformToString();
    const resources = parseTfStateResources(stateContent);

    cachedResources = resources;
    resourcesCacheExpiry = now + 5 * 60 * 1000; // 5분 캐시 적용

    return jsonResponse(200, resources);
  } catch (err) {
    console.error("[AWS-Resources] 리소스 로드 오류:", err.message);
    if (cachedResources) {
      console.log("[AWS-Resources] API 호출 실패로 인한 폴백 캐시 데이터 반환");
      return jsonResponse(200, cachedResources);
    }
    return jsonResponse(200, { error: `S3 리소스 로드 실패: ${err.message}` });
  }
}
// tfstate 리소스 파싱 관련 헬퍼 함수는 shared.mjs의 parseTfStateResources를 사용합니다.
