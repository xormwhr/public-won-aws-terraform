/**
 * ==============================================================================
 * Visitor Lambda Resolver - IP 기반 방문자 통계
 * ==============================================================================
 * 
 * AppSync에서 호출되며, 클라이언트 IP를 SHA-256 해싱하여
 * DynamoDB에 저장합니다. 같은 IP의 중복 방문은 카운트하지 않습니다.
 * 
 * [개인정보 보호]
 * - 원본 IP는 저장하지 않고, SHA-256 해시값만 저장
 * - 날짜별 Salt 적용으로 날짜 간 IP 추적 불가
 * - TTL 90일 설정으로 자동 삭제
 * 
 * [지원하는 필드]
 * - Mutation.recordVisit: 방문자 기록 (IP 기반 중복 방지)
 * - Mutation.recordPostView: 글 조회수 기록 (IP 기반 중복 방지)
 * ==============================================================================
 */

import { DynamoDBClient, PutItemCommand, UpdateItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { createHash } from "node:crypto";

// DynamoDB 클라이언트 초기화 (Lambda 컨테이너 재사용 시 캐싱)
const dynamodb = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME;

/**
 * IP 주소를 SHA-256으로 해싱합니다.
 * 날짜별 Salt를 적용하여 날짜 간 추적을 방지합니다.
 * 
 * @param {string} ip - 클라이언트 IP 주소
 * @param {string} salt - 날짜 또는 postId 기반 Salt
 * @returns {string} SHA-256 해시값
 */
function hashIp(ip, salt) {
    return createHash("sha256")
        .update(`${ip}:${salt}`)
        .digest("hex");
}

/**
 * KST(한국 표준시) 기준 오늘/어제 날짜를 계산합니다.
 * 
 * @returns {{ today: string, yesterday: string }} YYYY-MM-DD 형식
 */
function getKstDates() {
    const now = new Date();
    // UTC에 9시간 추가하여 KST 계산
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const today = kstNow.toISOString().split("T")[0];

    const kstYesterday = new Date(kstNow.getTime() - 24 * 60 * 60 * 1000);
    const yesterday = kstYesterday.toISOString().split("T")[0];

    return { today, yesterday };
}

/**
 * DynamoDB TTL값 계산 (현재 시점 + 90일)
 * 
 * @returns {number} Unix Epoch Seconds
 */
function getTtl() {
    return Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;
}

/**
 * 방문자 기록 (recordVisit) 처리
 * 1. IP 해시로 오늘 이미 방문했는지 확인 (PutItem + ConditionExpression)
 * 2. 신규 방문이면 오늘 카운터 +1, TOTAL 카운터 +1
 * 3. 이미 방문했으면 카운트 미증가
 * 4. 현재 통계 반환
 * 
 * @param {string} sourceIp - 클라이언트 IP
 * @returns {Promise<{today: number, yesterday: number, total: number}>}
 */
async function handleRecordVisit(sourceIp) {
    const { today, yesterday } = getKstDates();
    const ipHash = hashIp(sourceIp, today);
    const ttl = getTtl();

    let isNewVisit = false;

    // 1단계: IP 해시로 중복 체크 (ConditionalWrite)
    try {
        await dynamodb.send(new PutItemCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: { S: `VISITOR_IP#${today}` },
                SK: { S: ipHash },
                ttl: { N: String(ttl) },
            },
            // 이미 존재하면 ConditionalCheckFailedException 발생
            ConditionExpression: "attribute_not_exists(PK)",
        }));
        // PutItem 성공 = 신규 방문
        isNewVisit = true;
    } catch (err) {
        if (err.name === "ConditionalCheckFailedException") {
            // 이미 방문한 IP → 카운트 증가 안 함
            isNewVisit = false;
        } else {
            throw err;
        }
    }

    // 2단계: 신규 방문이면 카운터 증가
    if (isNewVisit) {
        // 오늘 카운터 +1
        await dynamodb.send(new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: { S: "VISITOR" },
                SK: { S: today },
            },
            UpdateExpression: "ADD #count :inc",
            ExpressionAttributeNames: { "#count": "count" },
            ExpressionAttributeValues: { ":inc": { N: "1" } },
        }));

        // TOTAL 카운터 +1
        await dynamodb.send(new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: { S: "VISITOR" },
                SK: { S: "TOTAL" },
            },
            UpdateExpression: "ADD #count :inc",
            ExpressionAttributeNames: { "#count": "count" },
            ExpressionAttributeValues: { ":inc": { N: "1" } },
        }));
    }

    // 3단계: 현재 통계 조회 (기존 getVisitorStats 로직 재사용)
    return await fetchVisitorStats(today, yesterday);
}

/**
 * 글 조회수 기록 (recordPostView) 처리
 * 1. IP 해시로 이 글을 이미 조회했는지 확인
 * 2. 신규 조회면 viewCount +1
 * 3. 업데이트된 viewCount 반환
 * 
 * @param {string} sourceIp - 클라이언트 IP
 * @param {string} postId - 글 ID
 * @returns {Promise<{viewCount: number}>}
 */
async function handleRecordPostView(sourceIp, postId) {
    const ipHash = hashIp(sourceIp, `post:${postId}`);
    const ttl = getTtl();

    let isNewView = false;

    // 1단계: IP 해시로 중복 체크
    try {
        await dynamodb.send(new PutItemCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: { S: `POST_VIEW#${postId}` },
                SK: { S: ipHash },
                ttl: { N: String(ttl) },
            },
            ConditionExpression: "attribute_not_exists(PK)",
        }));
        isNewView = true;
    } catch (err) {
        if (err.name === "ConditionalCheckFailedException") {
            isNewView = false;
        } else {
            throw err;
        }
    }

    // 2단계: 신규 조회면 Post의 viewCount +1
    if (isNewView) {
        const result = await dynamodb.send(new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: { S: `POST#${postId}` },
                SK: { S: `POST#${postId}` },
            },
            UpdateExpression: "ADD #vc :inc",
            ExpressionAttributeNames: { "#vc": "viewCount" },
            ExpressionAttributeValues: { ":inc": { N: "1" } },
            ReturnValues: "ALL_NEW",
        }));

        return {
            viewCount: Number.parseInt(result.Attributes?.viewCount?.N || "1", 10),
        };
    }

    // 이미 조회한 경우 현재 viewCount 반환
    const result = await dynamodb.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND SK = :sk",
        ExpressionAttributeValues: {
            ":pk": { S: `POST#${postId}` },
            ":sk": { S: `POST#${postId}` },
        },
    }));

    const item = result.Items?.[0];
    return {
        viewCount: Number.parseInt(item?.viewCount?.N || "0", 10),
    };
}

/**
 * 방문자 통계 조회
 * PK=VISITOR인 모든 아이템을 Query하여 오늘/어제/TOTAL 카운트를 추출합니다.
 * 
 * @param {string} today - 오늘 날짜 (YYYY-MM-DD)
 * @param {string} yesterday - 어제 날짜 (YYYY-MM-DD)
 * @returns {Promise<{today: number, yesterday: number, total: number}>}
 */
async function fetchVisitorStats(today, yesterday) {
    const result = await dynamodb.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
            ":pk": { S: "VISITOR" },
        },
    }));

    let todayCount = 0;
    let yesterdayCount = 0;
    let totalCount = 0;

    for (const item of result.Items || []) {
        const sk = item.SK.S;
        const count = Number.parseInt(item.count?.N || "0", 10);

        if (sk === today) todayCount = count;
        else if (sk === yesterday) yesterdayCount = count;
        else if (sk === "TOTAL") totalCount = count;
    }

    return { today: todayCount, yesterday: yesterdayCount, total: totalCount };
}

/**
 * Lambda Handler - AppSync Direct Lambda Resolver
 * 
 * AppSync가 이 함수를 호출할 때 event 구조:
 * {
 *   info: { fieldName: "recordVisit" | "recordPostView" },
 *   arguments: { postId?: string },
 *   request: { headers: { "x-forwarded-for": "1.2.3.4" } },
 *   identity: { sourceIp: ["1.2.3.4"] }
 * }
 */
export const handler = async (event) => {
    console.log("Event:", JSON.stringify(event, null, 2));

    // 클라이언트 IP 추출
    // AppSync는 identity.sourceIp를 배열로 제공
    const sourceIp =
        event.identity?.sourceIp?.[0] ||
        event.request?.headers?.["x-forwarded-for"]?.split(",")?.[0]?.trim() ||
        "unknown";

    const fieldName = event.info?.fieldName;

    switch (fieldName) {
        case "recordVisit":
            return await handleRecordVisit(sourceIp);

        case "recordPostView": {
            const postId = event.arguments?.postId;
            if (!postId) {
                throw new Error("postId is required for recordPostView");
            }
            return await handleRecordPostView(sourceIp, postId);
        }

        default:
            throw new Error(`Unknown field: ${fieldName}`);
    }
};
