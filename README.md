# 실습 코드 채점 도구

이 저장소는 기존 채점 규칙을 반영한 정적 웹 채점 페이지를 포함합니다.

## GitHub Pages

1. 저장소 설정에서 GitHub Pages 소스를 현재 브랜치의 `/docs` 폴더로 지정합니다.
2. 배포 후 `docs/index.html`이 웹 채점 페이지로 동작합니다.

## 사용 방법

1. 전체 제출물을 ZIP 하나로 압축합니다.
2. 웹 페이지에서 ZIP을 업로드하고, 암호화된 ZIP이면 비밀번호를 입력합니다.
3. 브라우저가 학생 폴더와 내부 ZIP을 찾아 노트북을 채점합니다.
4. 결과 표를 확인하고 `grading_results.csv`, `grading_report.md`를 다운로드합니다.

## 구현 메모

- 웹 버전은 `.zip`만 지원합니다.
- 암호화된 ZIP은 공통 비밀번호 입력란으로 복호화합니다.
- 학생 폴더에 ZIP이 없으면 직접 들어 있는 `.ipynb`도 채점 대상으로 사용합니다.
- 노트북이 여러 개면 가장 큰 파일을 우선 선택합니다.

## 검증

```bash
node --test tests/core.test.mjs
node --check docs/assets/core.mjs
node --check docs/assets/app.mjs
```
