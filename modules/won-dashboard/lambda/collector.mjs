import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// 한글 설명 주석: 매일 1회 실행되어 AWS Cost Explorer API에서 비용 데이터를 취합한 뒤 S3에 캐시 JSON으로 업로드하는 배치 함수입니다.
export const handler = async (event) => {
  const region = process.env.AWS_COST_REGION || "us-east-1";
  const bucketName = process.env.S3_BUCKET_NAME;
  const objectKey = "aws-cost-cache.json";

  const costClient = new CostExplorerClient({ region });
  // 한글 설명 주석: S3 클라이언트는 글로벌 비용 API와 달리 실제 S3 버킷이 생성된 리전(ap-northeast-2)을 명시적으로 사용해야 PermanentRedirect 에러를 방지할 수 있습니다.
  const s3Client = new S3Client({ region: process.env.AWS_REGION || "ap-northeast-2" });

  try {
    const now = new Date();
    // 1일 경계 에러 방지 및 오늘 당일 비용을 누락 없이 포함하기 위해 종료일을 항상 '오늘 + 1일'로 계산합니다.
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const endDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    const startDate = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;
    const currentMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    const monthlyCommand = new GetCostAndUsageCommand({
      TimePeriod: { Start: startDate, End: endDate },
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"]
    });

    const serviceCommand = new GetCostAndUsageCommand({
      TimePeriod: { Start: currentMonthStart, End: endDate },
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"],
      GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }]
    });

    const [monthlyResult, serviceResult] = await Promise.all([
      costClient.send(monthlyCommand),
      costClient.send(serviceCommand)
    ]);

    const responseData = {
      monthly: monthlyResult.ResultsByTime || [],
      services: serviceResult.ResultsByTime || []
    };

    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      Body: JSON.stringify(responseData),
      ContentType: "application/json"
    }));

    console.log("[aws-cost-collector] AWS 비용 데이터 수집 및 S3 캐싱 완료");
    return { statusCode: 200, body: "Success" };
  } catch (err) {
    console.error("[aws-cost-collector] 비용 수집 중 오류 발생:", err.message);
    throw err;
  }
};
