// ==============================================================================
// vitest.config.mjs - Vitest 루트 설정 파일
// 모든 Lambda 모듈의 단위 테스트를 통합 실행하고 lcov 형식으로 coverage를 생성합니다.
// ==============================================================================
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Lambda는 Node.js 런타임에서 실행되므로 node 환경 사용
    environment: 'node',
    // 테스트 파일 패턴: modules 하위 모든 *.test.mjs 파일
    include: ['modules/**/*.test.mjs'],
    // 전역 변수(describe, it, expect 등)를 import 없이 사용
    globals: true,
    coverage: {
      // V8 내장 coverage 제공자 사용 (별도 도구 불필요)
      provider: 'v8',
      // SonarQube가 인식하는 lcov 형식 + 개발자용 text, html 형식 출력
      reporter: ['lcov', 'text', 'html'],
      // coverage 측정 대상: Lambda 소스 파일 (테스트 파일 제외)
      include: ['modules/**/lambda/**/*.mjs'],
      // 테스트 파일 자체 및 복제된 shared.mjs는 coverage에서 제외
      exclude: [
        'modules/**/*.test.mjs',
        'modules/won-dashboard/lambda/shared.mjs',
        'modules/won-homepage/lambda/shared.mjs'
      ],
      // coverage report 출력 디렉토리 (lcov.info 생성 위치)
      reportsDirectory: './coverage',
    },
  },
});
