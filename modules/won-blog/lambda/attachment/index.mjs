/**
 * ==============================================================================
 * Attachment Lambda Resolver - S3 Presigned URL 생성
 * ==============================================================================
 * 
 * AppSync에서 호출되며, S3 Presigned Upload URL을 생성합니다.
 * 인증된 사용자(관리자)만 파일 업로드가 가능합니다.
 * 
 * [파일 제한]
 * - 파일당 최대 크기: 50MB
 * - 포스트당 최대 파일: 5개
 * - 허용 확장자: pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv,
 *                jpg, jpeg, png, gif, webp, zip, md
 * 
 * [보안]
 * - Presigned URL은 5분 후 만료
 * - 특정 S3 키에만 유효
 * - Content-Type 제한
 * ==============================================================================
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

// S3 클라이언트 초기화
const s3 = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME;

// 허용되는 확장자 목록
const ALLOWED_EXTENSIONS = new Set([
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv",
    "jpg", "jpeg", "png", "gif", "webp",
    "zip",
    "md",
    "drawio" // 한글 주석: Draw.io 다이어그램 파일 확장자 허용 추가
]);

// 허용되는 Content-Type 매핑
const ALLOWED_CONTENT_TYPES = new Set([
    // 문서
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
    "text/markdown",
    "application/vnd.jgraph.mxfile", // 한글 주석: Draw.io XML 파일 MIME 타입 허용 추가
    // 이미지
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    // 압축
    "application/zip",
    "application/x-zip-compressed",
]);

// 최대 파일 크기: 50MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * 파일명에서 확장자를 추출합니다.
 * @param {string} fileName - 파일명
 * @returns {string} 소문자 확장자
 */
function getExtension(fileName) {
    const parts = fileName.split(".");
    return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

/**
 * Presigned Upload URL 생성
 * 
 * @param {string} postId - 포스트 ID
 * @param {string} fileName - 원본 파일명
 * @param {string} contentType - MIME 타입
 * @param {number} fileSize - 파일 크기 (바이트)
 * @returns {Promise<{ url: string, s3Key: string }>}
 */
async function handleGetPresignedUploadUrl(postId, fileName, contentType, fileSize) {
    // 파일 크기 검증
    if (fileSize > MAX_FILE_SIZE) {
        throw new Error(`파일 크기가 50MB를 초과합니다: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);
    }

    // 확장자 검증
    const ext = getExtension(fileName);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
        throw new Error(`허용되지 않는 파일 형식입니다: .${ext}`);
    }

    // Content-Type 검증
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
        throw new Error(`허용되지 않는 Content-Type입니다: ${contentType}`);
    }

    // S3 키 생성: attachments/{postId}/{uuid}_{fileName}
    // UUID를 접두사로 추가하여 파일명 충돌 방지
    const uuid = randomUUID().split("-")[0];
    const safeFileName = fileName.replaceAll(/[^a-zA-Z0-9가-힣._-]/g, "_");
    const s3Key = `attachments/${postId}/${uuid}_${safeFileName}`;

    // Presigned URL 생성 (5분 만료)
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        ContentType: contentType,
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 300 });

    return { url, s3Key };
}

/**
 * Lambda Handler - AppSync Direct Lambda Resolver
 * 
 * event 구조:
 * {
 *   info: { fieldName: "getPresignedUploadUrl" },
 *   arguments: { postId, fileName, contentType, fileSize }
 * }
 */
export const handler = async (event) => {
    console.log("Attachment Lambda Event:", JSON.stringify(event, null, 2));

    const fieldName = event.info?.fieldName;

    // 한글 설명 주석: AppSync 필드명이 getPresignedUploadUrl인 경우 presigned S3 업로드 URL 생성을 처리합니다.
    if (fieldName === "getPresignedUploadUrl") {
        const { postId, fileName, contentType, fileSize } = event.arguments;

        if (!postId || !fileName || !contentType) {
            throw new Error("postId, fileName, contentType은 필수입니다.");
        }

        return await handleGetPresignedUploadUrl(
            postId, fileName, contentType, fileSize || 0
        );
    }

    throw new Error(`Unknown field: ${fieldName}`);
};
