# Blog Assistant

Obsidian에서 메타 액션 문법을 파싱해 Gemini로 글/이미지를 생성해 노트에 반영하는 플러그인입니다.

## 주요 기능

- `@(액션타입)[지시문]` 문법 파싱
- 텍스트 생성: 앞 문맥(최근 2문장)의 어투를 참고해 한국어로 작성
- 이미지 생성: Gemini 이미지 모델로 생성 후 `images/` 폴더에 저장
- API 키 관리: vault 루트 `.env`의 `GEMINI_API_KEY` 사용

## 메타 액션 문법

기본 형식:

```text
@(액션타입)[지시문]
```

예시:

```text
@(요약)[위 내용을 3문장으로 요약해줘]
@(이미지 생성)[봄비 오는 한강 야경 일러스트]
```

- `이미지 생성`:
  - 생성된 이미지를 `images/<파일명>.png|jpg...`로 저장
  - 노트에 `![...](images/...)` 형태로 삽입
- 그 외 액션 타입:
  - 지시문에 맞는 텍스트를 생성해 원문 치환

## 사용 방법

1. 플러그인 명령 `Set API key` 실행
2. API 키 입력 후 저장
   - `.env`에 `GEMINI_API_KEY=...`로 저장됩니다.
3. 노트에 메타 액션 작성
4. 명령 `Process meta actions in current note` 실행

## 개발

```bash
npm install
npm run dev
```

검증:

```bash
npm run lint
npm run build
```

## 릴리즈 파일

GitHub Release에는 아래 파일을 개별 첨부해야 합니다.

- `main.js`
- `manifest.json`
- `styles.css` (있는 경우)

릴리즈 태그/이름은 `manifest.json` 버전과 동일하게 맞추고 `v` 접두사는 사용하지 않습니다.

## 라이선스

`LICENSE` 파일을 따릅니다.
