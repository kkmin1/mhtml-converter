# mhtml-converter

MHTML 파일을 `HTML`, `Markdown`, `TXT` 형식으로 변환하기 위한 웹 기반 도구입니다.

ChatGPT, Gemini, Grok 등 LLM 서비스에서 저장한 MHTML 파일을 읽어 대화 내용을 정리된 문서 형태로 변환하는 데 사용할 수 있습니다.

## 개요

이 도구는 브라우저에서 바로 실행되는 정적 웹앱입니다.

주요 기능:

- MHTML 파일 자동 인식
- 일반 HTML 파일 처리
- ChatGPT / Gemini / Grok 계열 페이지 자동 감지
- HTML / Markdown / TXT 출력
- HTML/Markdown 저장 시 필요한 이미지 자산을 `media` 폴더로 분리
- 브라우저에서 바로 실행 가능

## 주요 파일

- `index.html`  
  통합 진입 페이지

- `mhtml-converter.js`  
  MHTML 파싱 및 변환 로직

- `mhtml-converter.css`  
  공통 스타일

- `gpt-converter.html`  
  ChatGPT 변환기 UI

- `gemini-converter.html`  
  Gemini 변환기 UI

- `grok-converter.html`  
  Grok 변환기 UI

## 실행 방법

저장소 폴더에서 간단한 HTTP 서버를 실행합니다.

```bash
python -m http.server 8000
```

브라우저에서 아래 주소로 접속합니다.

```text
http://localhost:8000
```

또는 `index.html` 파일을 브라우저에서 직접 열 수도 있습니다.

## 사용 방법

1. 브라우저에서 변환기 페이지를 엽니다.
2. `.mhtml`, `.mht`, `.html`, `.htm` 파일을 선택하거나 드래그합니다.
3. 출력 형식을 선택합니다.
   - HTML
   - Markdown
   - TXT
4. 변환 버튼을 누릅니다.
5. 결과 파일을 저장합니다.

## 용도

- LLM 대화 내용을 읽기 쉬운 문서로 변환
- ChatGPT / Gemini / Grok 대화 백업 정리
- HTML 문서를 Markdown이나 TXT로 변환
- 웹페이지 저장본에서 본문만 추출
- 이미지가 포함된 결과물을 HTML/Markdown + media 폴더 구조로 정리

## ChatGPT MHTML 저장 시 주의할 점

ChatGPT 대화가 긴 경우, 브라우저에서 `웹페이지 저장` 또는 `MHTML 저장`을 해도 **전체 대화가 저장되지 않을 수 있습니다.**

이는 변환기 문제가 아니라 ChatGPT 웹페이지의 렌더링 방식 때문입니다.

ChatGPT는 긴 대화를 표시할 때 모든 메시지를 한꺼번에 HTML DOM에 유지하지 않을 수 있습니다. 성능을 위해 현재 화면 근처의 메시지만 DOM에 남기고, 사용자가 스크롤할 때 필요한 메시지를 다시 렌더링하거나 로드하는 방식으로 동작할 수 있습니다.

따라서 MHTML 파일에는 다음 중 하나가 저장될 수 있습니다.

- 전체 대화
- 현재 화면 근처의 일부 대화
- 앞부분이나 중간이 빠진 대화
- 첫 메시지가 사용자 메시지가 아니라 assistant 메시지로 시작하는 부분 스냅샷

짧은 대화는 전체가 저장되는 경우가 많습니다.  
하지만 긴 스레드는 MHTML로 저장해도 전체 보관이 보장되지 않습니다.

특히 다음과 같은 경우에는 부분 저장일 가능성이 큽니다.

- 변환 결과의 첫 메시지가 `user`가 아니라 `assistant`로 시작하는 경우
- 원래 대화보다 추출된 메시지 수가 현저히 적은 경우
- 대화 중간부터만 변환된 것처럼 보이는 경우

긴 ChatGPT 대화를 완전하게 보관하려면 MHTML 저장만 믿기보다는 다음 방법을 함께 고려하는 것이 좋습니다.

- ChatGPT 데이터 내보내기(export)
- 대화 내용을 직접 복사하여 별도 문서로 저장
- 브라우저 인쇄/PDF 저장
- 공유 페이지가 전체 대화를 표시하는 경우 공유 페이지 저장

## 한계

- MHTML에 포함되지 않은 내용은 복구할 수 없습니다.
- 일부 웹앱은 저장 시점의 화면 DOM 일부만 MHTML에 포함할 수 있습니다.
- LLM 서비스의 HTML 구조가 바뀌면 메시지 추출 로직을 업데이트해야 할 수 있습니다.
- 동적 JavaScript 실행 결과나 서버 측 원본 데이터는 MHTML에 포함되지 않을 수 있습니다.

## 보안 참고

이 도구는 브라우저에서 로컬로 동작하는 정적 웹앱입니다.  
파일은 사용자의 브라우저에서 읽고 변환되며, 별도 서버로 업로드하지 않습니다.

