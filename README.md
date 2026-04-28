# mhtml-converter

MHTML 파일을 `HTML`, `Markdown`, `TXT`로 변환하기 위한 웹 기반 도구 모음입니다.

## 개요

일반 웹페이지 MHTML뿐 아니라 GPT, Gemini, Grok 계열 MHTML도 자동으로 구분해서 변환하는 실험용 변환기입니다.

주요 파일:
- `index.html`: 통합 진입점
- `mhtml-converter.js`: 변환 로직
- `mhtml-converter.css`: 공통 스타일
- `gemini-converter.html`, `gpt-converter.html`, `grok-converter.html`: 플랫폼별 개별 UI

## 기능

- MHTML 자동 판별
- HTML / MD / TXT 출력
- HTML/MD 저장 시 media 폴더를 함께 다루는 흐름 지원
- 브라우저에서 바로 실행 가능한 정적 도구 구조

## 실행 방법

```bash
python -m http.server 8000
```

브라우저에서 `http://localhost:8000`으로 접속한 뒤 `index.html`을 엽니다.

## 용도

- 웹페이지 보관본을 읽기 쉬운 형식으로 변환
- LLM 대화 보관본을 Markdown으로 정리
- HTML/텍스트 후처리 파이프라인의 전처리 단계로 사용
