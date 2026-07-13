/**
 * Post Handler Lambda
 * 포스트 삭제 시 DynamoDB 항목과 S3 첨부파일을 통합적으로 정리합니다.
 *
 * [인증 전략]
 * AppSync의 @aws_cognito_user_pools 디렉티브가 1차 인증을 담당합니다.
 * 이 람다는 인증된 Cognito 사용자만 도달할 수 있으므로,
 * 람다 내부에서 소유권을 이중 검증할 필요가 없습니다.
 */

import { DynamoDBClient, GetItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const ddb = new DynamoDBClient({});
const s3 = new S3Client({});
const TABLE_NAME = process.env.TABLE_NAME;
const BUCKET_NAME = process.env.BUCKET_NAME;

export const handler = async (event) => {
    // AppSync가 전달하는 identity 객체 전체를 로깅 (디버깅용)
    console.log("Event identity:", JSON.stringify(event.identity, null, 2));

    // AppSync @aws_cognito_user_pools 인증 통과 여부 확인
    // event.identity가 없으면 미인증 요청이므로 차단
    if (!event.identity) {
        throw new Error("Unauthorized: Authentication required");
    }

    const { id } = event.arguments;
    const pk = `POST#${id}`;
    const sk = `POST#${id}`;

    try {
        // 1. 포스트 정보 조회 (첨부파일 목록 확보)
        const getResult = await ddb.send(new GetItemCommand({
            TableName: TABLE_NAME,
            Key: marshall({ PK: pk, SK: sk })
        }));

        if (!getResult.Item) {
            throw new Error("Post not found");
        }

        const post = unmarshall(getResult.Item);

        // 2. DynamoDB 항목 삭제
        await ddb.send(new DeleteItemCommand({
            TableName: TABLE_NAME,
            Key: marshall({ PK: pk, SK: sk })
        }));

        // 3. S3 첨부파일 삭제 (첨부파일이 있는 경우에만)
        if (post.attachments && post.attachments.length > 0) {
            const deleteKeys = post.attachments
                .filter(attr => attr.s3Key)
                .map(attr => ({ Key: attr.s3Key }));

            if (deleteKeys.length > 0) {
                console.log("Deleting S3 objects:", deleteKeys);
                await s3.send(new DeleteObjectsCommand({
                    Bucket: BUCKET_NAME,
                    Delete: { Objects: deleteKeys }
                }));
            }
        }

        // 4. 삭제된 포스트 정보 반환 (GraphQL Schema의 Post 타입 필드 준수)
        console.log("Post deleted successfully:", id);
        return post;

    } catch (error) {
        console.error("Error in deletePost handler:", error);
        throw error;
    }
};
