# 개인 포털 (s2ongrae.github.io)

가계부·보험관리툴로 가는 허브 + 캘린더·할 일(Google Tasks)·메모(Keep 스타일). GitHub Pages 로 `index.html` 을 배포하고, 서버는 Google Apps Script 웹 앱(`apps-script/Code.gs`)이다. 메모는 Drive `김성래포털/포털_메모.json` 에 저장한다.

> **이 저장소는 공개다(GitHub Pages).** 서버 주소·비밀 키는 코드·문서·테스트에 넣지 않는다. 각 기기의 ⚙️ 서버 설정에서 입력해 localStorage 에만 있다. 보험관리툴과 **주소도 키도 별개**다.

## 작업 규칙 (반드시)

- 수정 후 `npm test` (정적 검사 + 테스트 3종) 가 전부 ✅ 인지 확인한다. 처음이면 `npm install`.
- 실패하면 앱 버그인지 테스트 실수인지 먼저 가려서 말한다. 검사를 약하게 만들어 통과시키지 않는다.
- 새 기능·수정에는 테스트를 같이 추가하고, 가능하면 고치기 전 파일에서 실제로 실패하는지 확인한다.
- 화면에 넣는 값은 `esc()` 로 (캘린더 초대 제목은 다른 사람이 정할 수 있는 값이다). 메모 색상은 허용 목록(`MEMO_COLORS`)만.
- 사용자는 "메모는 날아가면 안 된다"고 했다. 메모 저장·동기화 로직은 특히 조심하고, 바꾸면 테스트를 늘린다.

## 구조

- `index.html`: 헤더(가계부·보험관리툴 링크, ⚙️ 서버) / 할 일(목록 탭, 추가, 완료, 삭제) / 캘린더(월 보기, 날짜 클릭 → 일정 보기·추가·삭제) / 메모(추가·편집·색상·고정·삭제).
- 서버 호출은 `serverCall(action, payload)` 하나로 통일(모든 요청에 키). 할 일·캘린더용 `post()` 는 예외 대신 `{ok:false, code:'noconfig'|'unauthorized'}` 를 돌려준다.
- 서버 설정이 없으면 서버 요청을 보내지 않고 이 기기 메모만 보여준다.

## 메모 동기화

- `// <MEMO_CORE>` ~ `// </MEMO_CORE>` 구간은 순수 함수다. 테스트가 이 구간을 뽑아 검증하므로 표시를 지우지 않는다.
- 메모 = `{id, title, body, color, pinned, updatedAt}`. 예전 메모(id 없음)는 내용 해시로 고정 id 를 붙인다(`normalizeMemoList`) → 어느 기기에서든 같은 id.
- 3-way 병합(`mergeMemos`)은 보험관리툴과 같은 규칙 + 삭제 기록(60일). 순서: 서버에서 새로 온 메모(최신순) → 이 기기 순서.
- 이 기기: `portal_memos_v3`(예전 `portal_memos_v2` 를 이어받음), `portal_memo_tombs`, `portal_memo_base`, 체크포인트 `portal_mcp_*`(최대 3개, ⚙️ 창에서 복원). 서버 주소·키: `portal_server_url`, `portal_server_key`.
- 저장은 즉시 로컬 + 1초 뒤 동기화(`persistMemos`). 체크포인트 복원은 force 저장.

## 서버 (Code.gs)

- POST 전용, 모든 요청에 비밀 키. `doGet` 은 안내 문구만.
- 동작: `ping`, `getTaskLists`, `getTasks`, `addTask`, `completeTask`, `deleteTask`, `getCalendarEvents`(ym), `createEvent`, `deleteEvent`, `loadMemos`, `saveMemos`(baseRev, force).
- 입력 검사: 월·날짜·시간 형식, ID 길이, 제목 길이. 종료 시간이 없거나 시작보다 빠르면 1시간짜리로.
- 메모 저장: 잠금, rev 확인, 절반 아래로 줄면 `shrink` 거부, 하루 1회 백업(14일), 손상 파일 보호.
- Apps Script 서비스(+)에 **Tasks API** 가 추가돼 있어야 한다.

## 배포

- 앱: `index.html` 을 GitHub 에 올리면 끝.
- 서버: Code.gs 를 붙여 넣고 배포 관리 → 새 버전. 보안 설정을 처음 할 때만 새 배포 + `createSecretKey` + 옛 배포 보관.

## 테스트

- `tests/lib/portal_fake_server.js`: 가짜 CalendarApp·Tasks·DriveApp 위에서 실제 Code.gs 실행.
- `portal_integration.test.js` 는 포털 스크립트 전체를 가짜 브라우저에서 돌린다. 시간대 Asia/Seoul 고정.
- 테스트 종류: `portal_server`, `portal_merge`(메모 병합 규칙), `portal_integration`.
