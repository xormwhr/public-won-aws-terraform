// ==============================================================================
// modules/lambda-shared/lambda/shared.mjs
// Lambda 함수 간의 코드 중복을 제거하기 위한 공통 모듈 라이브러리
// ==============================================================================

import { GetParametersByPathCommand } from "@aws-sdk/client-ssm";
import { GetObjectCommand } from "@aws-sdk/client-s3";

/**
 * 한글 설명 주석: CORS 처리 및 JSON 직렬화를 일관되게 적용하여 API Gateway 규격 응답을 반환합니다.
 * @param {number} statusCode - HTTP 상태 코드
 * @param {string|object} body - 응답 본문 데이터 (객체 전달 시 자동 JSON 직렬화 수행)
 * @returns {object} Lambda 프록시 응답 형식 객체
 */
export function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

// 한글 설명 주석: SSM 파라미터 로딩 캐시 변수 정의
let cachedParams = null;

/**
 * 한글 설명 주석: 외부 모듈에서 캐싱된 파라미터 값을 업데이트하거나 무효화할 수 있도록 지원하는 setter 함수입니다.
 * @param {string} key - 업데이트할 파라미터 키
 * @param {any} value - 새로 갱신할 파라미터 값
 */
export function setCachedParam(key, value) {
  if (cachedParams) {
    cachedParams[key] = value;
  }
}

/**
 * 한글 설명 주석: AWS SSM Parameter Store에서 지정된 접두사 하위의 변수를 로드하고 인메모리에 캐싱합니다.
 * @param {SSMClient} ssmClient - AWS SDK v3 SSM 클라이언트 인스턴스
 * @param {string} prefix - 조회할 파라미터 경로 접두사 (예: "/won-dashboard/")
 * @returns {Promise<object>} 로드된 파라미터 맵 객체
 */
export async function getParams(ssmClient, prefix) {
  if (cachedParams) return cachedParams;
  try {
    cachedParams = {};
    let nextToken;
    do {
      const cmd = new GetParametersByPathCommand({
        Path: prefix,
        WithDecryption: true,
        NextToken: nextToken
      });
      const res = await ssmClient.send(cmd);
      for (const p of res.Parameters || []) {
        const key = p.Name.startsWith(prefix) ? p.Name.slice(prefix.length) : p.Name;
        cachedParams[key] = p.Value;
      }
      nextToken = res.NextToken;
    } while (nextToken);
    console.log("[SSM] 로드된 파라미터 키:", Object.keys(cachedParams));
  } catch (err) {
    console.error("[SSM] 파라미터 조회 실패:", err.message);
    cachedParams = {};
  }
  return cachedParams;
}

// 한글 설명 주석: AWS 비용 캐시용 상태 변수 및 TTL 설정 (10분)
let cachedCostData = null;
let lastCostFetchTime = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * 한글 설명 주석: S3 버킷의 aws-cost-cache.json 파일을 조회하여 비용 데이터를 응답합니다.
 * @param {S3Client} s3Client - AWS SDK v3 S3 클라이언트 인스턴스
 * @param {string} bucketName - 비용 캐시 파일이 적재된 S3 버킷 명칭
 * @returns {Promise<object>} AWS 비용 API 응답 객체
 */
export async function handleAwsCost(s3Client, bucketName) {
  const nowTime = Date.now();
  if (cachedCostData && (nowTime - lastCostFetchTime < CACHE_TTL_MS)) {
    console.log("[AWS-Cost] 인메모리 캐싱된 비용 데이터 반환");
    return jsonResponse(200, cachedCostData);
  }

  const objectKey = "aws-cost-cache.json";
  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: objectKey
    }));
    const dataString = await response.Body.transformToString();
    const responseData = JSON.parse(dataString);

    cachedCostData = responseData;
    lastCostFetchTime = nowTime;
    console.log("[AWS-Cost] S3 캐시 비용 데이터 조회 및 인메모리 캐싱 완료");

    return jsonResponse(200, responseData);
  } catch (err) {
    console.error("[AWS-Cost] S3 비용 캐시 조회 실패:", err.message);
    if (cachedCostData) {
      console.log("[AWS-Cost] S3 호출 실패로 인한 폴백 캐시 데이터 반환");
      return jsonResponse(200, cachedCostData);
    }
    return jsonResponse(200, { error: `AWS 비용 캐시 조회 실패: ${err.message}` });
  }
}

/**
 * 한글 설명 주석: ArgoCD API의 application 목록을 조회하여 프록시 응답합니다.
 * @param {string} argocdUrl - ArgoCD 서버의 기본 URL 주소
 * @param {string} token - ArgoCD API 인증 토큰
 * @param {object} options - 에러 응답 규격을 지정하는 옵션 객체 (errorType: 'homepage' 또는 'dashboard')
 * @returns {Promise<object>} 프록시 응답 객체
 */
export async function handleArgoCD(argocdUrl, token, { errorType = 'dashboard' } = {}) {
  // 한글 설명 주석: 구조 분해 할당을 통해 기본값 'dashboard'를 안전하게 확보하여 소나큐브 S7737 방지
  const isHomepage = errorType === 'homepage';

  if (!argocdUrl || !token) {
    const errorMsg = isHomepage ? "ARGOCD_ENV_NOT_SET" : "ArgoCD URL 또는 API 토큰 설정 누락";
    return jsonResponse(200, { error: errorMsg });
  }

  const apiPath = "/api/v1/applications";
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  try {
    const res = await fetch(`${argocdUrl}${apiPath}`, { headers });
    const text = await res.text();
    if (!res.ok) {
      const errorMsg = isHomepage
        ? `ArgoCD 연동 대상 서버 에러 발생 (HTTP ${res.status})`
        : `ArgoCD API 오류 (HTTP ${res.status})`;

      const responseBody = isHomepage
        ? { error: errorMsg, details: text }
        : { error: errorMsg, upstreamStatus: res.status };

      return jsonResponse(200, responseBody);
    }
    return jsonResponse(200, text);
  } catch (err) {
    const errorMsg = isHomepage
      ? `ArgoCD 연동 대상 서버 에러 발생: ${err.message}`
      : `ArgoCD API 연결 실패: ${err.message}`;
    return jsonResponse(200, { error: errorMsg });
  }
}

/**
 * 한글 설명 주석: tfstate JSON 데이터를 파싱하여 대시보드 리소스 규격인 AwsResource 배열로 가공합니다.
 * @param {string} stateContent - S3에서 조회한 tfstate 파일의 JSON 내용 문자열
 * @param {object} options - 파싱 가공 제어 옵션 (stripDetails: true 지정 시 세부 속성 및 의존관계 정보를 소거하여 보안 강화)
 * @returns {Array} 가공 처리 완료된 AwsResource 목록 배열
 */
export function parseTfStateResources(stateContent, { stripDetails = false } = {}) {
  // 한글 설명 주석: 구조 분해 할당을 통해 기본값 false를 안전하게 확보하여 소나큐브 S7737 방지
  if (!stateContent) return [];
  try {
    const state = JSON.parse(stateContent);
    const rawResources = state.resources || [];
    const result = [];

    const typeMap = {
      aws_vpc: "VPC",
      aws_subnet: "Subnet",
      aws_lb: "ALB",
      aws_alb: "ALB",
      aws_instance: "EC2",
      aws_dynamodb_table: "DynamoDB",
      aws_cognito_user_pool: "Cognito",
      aws_cloudfront_distribution: "CloudFront",
      aws_lambda_function: "Lambda",
      aws_kms_key: "KMS",
      aws_appsync_graphql_api: "AppSync",
      aws_iam_openid_connect_provider: "OIDC Provider",
      aws_cognito_user_group: "User Group",
      aws_cognito_user_pool_client: "App Client",
      aws_acm_certificate: "ACM Cert",
      aws_route53_record: "Route53 Record",
      aws_route53_zone: "Route53 Zone",
      aws_iam_role: "IAM Role",
      aws_iam_policy: "IAM Policy",
      aws_iam_role_policy_attachment: "IAM Attachment",
      aws_security_group: "Security Group",
      aws_security_group_rule: "SG Rule",
      aws_api_gateway_rest_api: "API Gateway",
      aws_api_gateway_resource: "API Resource",
      aws_api_gateway_method: "API Method",
      aws_api_gateway_integration: "API Integration",
      aws_api_gateway_deployment: "API Deployment",
      aws_api_gateway_stage: "API Stage",
      aws_s3_bucket: "S3 Bucket",
      aws_s3_bucket_policy: "S3 Policy",
      aws_ssm_parameter: "SSM Parameter",
      aws_cognito_identity_pool: "Identity Pool"
    };

    const formatFallbackType = (rawType) => {
      if (!rawType) return "";
      const cleanType = rawType.replace(/^aws_/, "");
      return cleanType
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    };

    for (const res of rawResources) {
      if (res.mode !== "managed") continue;

      const displayType = typeMap[res.type] || formatFallbackType(res.type);
      const instances = res.instances || [];
      const modulePrefix = res.module ? res.module.replaceAll(".", "_") : "";

      for (let idx = 0; idx < instances.length; idx++) {
        const mapped = mapResourceInstance(res, instances[idx], idx, displayType, modulePrefix, { stripDetails });
        result.push(mapped);
      }
    }
    return result;
  } catch (e) {
    console.error("tfstate 파싱 오류:", e);
    return [];
  }
}

/**
 * 한글 설명 주석: 개별 테라폼 리소스 인스턴스 정보를 AwsResource 객체로 매핑합니다.
 * @param {object} res - 리소스 메타데이터
 * @param {object} inst - 리소스 실체 인스턴스
 * @param {number} idx - 다중 리소스 내의 인덱스 번호
 * @param {string} displayType - UI에 노출할 대분류 타입 명칭
 * @param {string} modulePrefix - 모듈 접두사 문자열
 * @param {object} options - 보안 소거 여부를 결정하는 옵션 객체
 * @returns {object} 표준화된 AwsResource 정보 객체
 */
function mapResourceInstance(res, inst, idx, displayType, modulePrefix, { stripDetails = false } = {}) {
  // 한글 설명 주석: 구조 분해 할당을 통해 기본값 false를 안전하게 확보하여 소나큐브 S7737 방지
  const attrs = inst.attributes || {};
  const name = attrs.tags?.Name || res.name;
  const idSuffix = res.instances.length > 1 ? `-${idx}` : "";
  const id = modulePrefix
    ? `${modulePrefix}-${res.type.replace("aws_", "")}-${res.name}${idSuffix}`
    : `${res.type.replace("aws_", "")}-${res.name}${idSuffix}`;
  const description = modulePrefix
    ? `[${res.module}] ${res.type}.${res.name} 리소스`
    : `${res.type}.${res.name} 리소스`;

  if (stripDetails) {
    return {
      id: id,
      name: name,
      type: displayType,
      description: description,
      properties: {},
      dependencies: []
    };
  }

  return {
    id: id,
    name: name,
    type: displayType,
    description: description,
    properties: {
      arn: attrs.arn || "",
      ...attrs
    },
    dependencies: res.dependencies || [],
    cost: 0,
    costDetails: "테라폼 정보기반 연동"
  };
}
