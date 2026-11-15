# 개인 포털 (s2ongrae.github.io)

가계부·보험관리툴로 가는 허브 + 캘린더·할 일(Google Tasks)·메모(Keep 스타일). GitHub Pages 로 `index.html` 을 배포하고, 서버는 Google Apps Script 웹 앱(`apps-script/Code.gs`)이다. 메모는 Drive `김성래포털/포털_메모.json` 에 저장한다.

> **이 저장소는 공개다(GitHub Pages).** 서버 주소·비밀 키는 코드·문서·테스트에 넣지 않는다. 각 기기의 ⚙️ 서버 설정에서 입력해 localStorage 에만 있다. 보험관리툴과 **주소도 키도 별개**다.

## 작업 규칙 (반드시)

- 수정 후 `npm test` (정적 검사 + 테스트 5종) 가 전부 ✅ 인지 확인한다. 처음이면 `npm install`.
- 실패하면 앱 버그인지 테스트 실수인지 먼저 가려서 말한다. 검사를 약하게 만들어 통과시키지 않는다.
- 새 기능·수정에는 테스트를 같이 추가하고, 가능하면 고치기 전 파일에서 실제로 실패하는지 확인한다.
- 화면에 넣는 값은 `esc()` 로 (캘린더 초대 제목은 다른 사람이 정할 수 있는 값이다). 메모 색상은 허용 목록(`MEMO_COLORS`)만.
- 사용자는 "메모는 날아가면 안 된다"고 했다. 메모 저장·동기화 로직은 특히 조심하고, 바꾸면 테스트를 늘린다.

## 구조

- `index.html`: 헤더(가계부·보험관리툴·사전진단툴·콘텐츠 허브·스마트스토어 링크 — 폰에서는 아이콘만, ⚙️ 서버, 상태등 3개) / 할 일(목록 탭, 추가, 완료, 삭제) / 캘린더(월 보기, 날짜 클릭 → 일정 보기·추가·삭제) / 메모(추가·편집·색상·고정·삭제) / 🤖 노트북 오더함(오더 접수·승인/거절·결과 타임라인).
- 서버 호출은 `serverCall(action, payload)` 하나로 통일(모든 요청에 키). 할 일·캘린더용 `post()` 는 예외 대신 `{ok:false, code:'noconfig'|'unauthorized'}` 를 돌려준다.
- 서버 설정이 없으면 서버 요청을 보내지 않고 이 기기 메모만 보여준다.

## 사전진단툴 (`prediag/index.html` → https://s2ongrae.github.io/prediag/)

- **다른 앱(가계부·보험관리툴·포털)으로 가는 링크를 이 화면에 넣지 않는다**(고객이 직접 쓰는 화면이라서, 사용자 결정 2026-11-06). 반대로 세 앱의 헤더에는 이 툴로 가는 🩺 링크가 있다. `tests/prediag.test.js` 가 지킨다.
- 고객이 직접 채우는 4단계(기본정보 → 알릴의무 → 리스크 진단 → 제출). 예전엔 Netlify(`dreamy-chebakia-206c7a.netlify.app`)에 파일만 있었고, 2026-11 이 저장소로 옮겼다.
- React 18 + Babel standalone(브라우저에서 JSX 변환). 계산 함수는 `// <PREDIAG_CORE>` 일반 스크립트 구간에 있고 `tests/prediag.test.js` 가 그 구간을 뽑아 검증한다(표시 지우지 말 것).
- 보험나이: 주민번호 앞 6자리 + 뒷자리 첫 숫자(세기·성별)로 생년월일 → 만 나이 + 직전 생일 후 6개월 이상이면 +1 (`insAgeFromRrn`). "만 ○세"로 표시하지 않는다(보험나이는 만 나이가 아님).
- 제출은 Formspree(`FORMSPREE_ID`)로 설계사 메일에 간다. **주민번호 전체를 받는 것은 사용자 결정(2026-11-05)**. 대신 "암호화되어 안전" 같은 사실과 다른 문구는 쓰지 않는다. 건강 정보(알릴의무)는 민감정보라 별도 동의 체크는 아직 없음(사용자에게 제안만 함).
- Formspree 에 허용 도메인을 걸어 두었다면 `s2ongrae.github.io` 를 추가해야 전송된다.

## 메모 동기화
- **2026-11-15 점검으로 고친 규칙 (`memo-safety` 테스트)**: 메모 편집·삭제·고정은 목록 위치가 아니라 **메모 id** 로 찾는다(`editId`, `data-id` — 편집 중 동기화로 순서가 바뀌면 다른 메모를 덮어썼음). `lsSet` 은 성공 여부를 돌려주고 저장 공간이 차면 체크포인트를 비운 뒤 재시도, `commitMemoBase` 는 메모가 이 기기에 저장되지 않았으면 기준을 바꾸지 않는다. `_syncMemosOnce` 는 저장 전에 받은 Drive 상태를 기준으로 남긴다(충돌 후 재시도 때 다른 기기 최신 메모를 덮어쓰던 문제). 할 일 추가·완료는 `d.ok` 를 확인하고 실패하면 입력을 남긴다. 사전진단툴 외부 스크립트 3개는 cdnjs 공식 SRI(sha512) + `crossorigin` — 버전을 바꾸면 해시도 새로.


- `// <MEMO_CORE>` ~ `// </MEMO_CORE>` 구간은 순수 함수다. 테스트가 이 구간을 뽑아 검증하므로 표시를 지우지 않는다.
- 메모 = `{id, title, body, color, pinned, updatedAt}`. 예전 메모(id 없음)는 내용 해시로 고정 id 를 붙인다(`normalizeMemoList`) → 어느 기기에서든 같은 id.
- 3-way 병합(`mergeMemos`)은 보험관리툴과 같은 규칙 + 삭제 기록(60일). 순서: 서버에서 새로 온 메모(최신순) → 이 기기 순서.
- 이 기기: `portal_memos_v3`(예전 `portal_memos_v2` 를 이어받음), `portal_memo_tombs`, `portal_memo_base`, 체크포인트 `portal_mcp_*`(최대 3개, ⚙️ 창에서 복원). 서버 주소·키: `portal_server_url`, `portal_server_key`.
- 저장은 즉시 로컬 + 1초 뒤 동기화(`persistMemos`). 체크포인트 복원은 force 저장.

## 상단 링크·상태등 (2026-11-15)

- 헤더 링크는 **5개 고정 순서**: 가계부 · 보험관리툴 · 사전진단툴 · 🎬 콘텐츠 허브(`s2ongrae.github.io/content-hub/`) · 🛍️ 스마트스토어.
- **스마트스토어는 주소를 넣기 전엔 열리지 않는다**: `localStorage.portal_store_url`(https 만) → 없으면 `.off` 점선 + 클릭 시 "⚙️ 설정에 넣어주세요" 안내만. 주소는 ⚙️ 창의 "이 링크만 저장"으로 저장한다(서버 연결 테스트와 무관).
- **상태등 3개** = 노트북 응답 · 밀린 명령 · 토스 동기화. 서버 `queue_status` 한 번으로 읽고 **이 기기에 5분 캐시**(`portal_qstatus_cache`). 배지 클릭 = 강제 새로고침.
- **빨간 에러를 보여 주지 않는 경우**: ① 서버 설정 전(`reason:'noconfig'`) ② 서버가 아직 `queue_status` 를 모르는 예전 배포(`reason:'unsupported'`) → 셋 다 `미연결 (세팅 대기)` + 무엇을 하면 되는지 title 로 안내. 실패도 5분 캐시에 담아 반복 호출을 막는다.
- 임계값(Code.gs): 노트북 초록 5분 이내 / 노랑 1시간 이내 / 빨강 그 뒤. 밀린 명령은 TIMEOUT_REVIEW 1건 이상, PENDING 15분 초과 = 빨강, PENDING 2건 이상·승인 대기 1건 이상 = 노랑. 토스는 1일 이내 초록 / 3일까지 노랑 / 4일+ 빨강.
- **시트 시각은 '노트북 생존'의 정확한 근거가 아니다** — 노트북 `heartbeat.json` 은 노트북 디스크에만 있어서, 드라이브에 올려 두고 `HEARTBEAT_FILE_ID` 를 넣기 전까지는 `Command_Queue` 의 마지막 활동 시각을 '대략'으로 쓴다(그래서 시트 기준엔 빨강을 주지 않는다).

## 🤖 노트북 오더함 (2026-11-15)

- 페이지 맨 아래 `「🤖 노트북 오더함」` 카드 하나로 **오더 접수 → 승인/거절 → 결과 확인**을 포털 안에서 끝낸다(텔레그램·슬랙 없이). 오더는 `Command_Queue` 시트에 쌓이고 노트북(`hub-agent` 워커)이 집어 가 실행한다.
- 화면: 작업 위치 선택(`ord-ws`) · `[🔄 코드 최신화]`(git_pull) · `[📈 토스 동기화]`(toss_sync) · 메모형 입력창 + `[오더 보내기]`(claude_prompt) · `파일 수정 허용` 체크 · 타임라인(`ord-list`) + `⟳` 새로고침.
- **`파일 수정 허용`(mode=edit)은 절대 바로 실행하지 않는다** → `WAITING_APPROVAL` 로 세우고 15분 안에 `[✅ 승인]`을 눌러야 `PENDING` 으로 내려간다(지나면 `EXPIRED`). 승인은 payload 해시에 묶여 있다(`approval_hash`).
- 목록은 최근 18건(최대 20). **payload 원문은 내보내지 않는다** — 주민·전화번호는 `[REDACTED]`, 내용은 한 줄 요약. 결과·오류도 같은 규칙으로 가린다.
- 서버가 예전 배포(오더함 모름)·`QUEUE_SHEET_ID` 미설정·시트 칸 부족·통신 실패면 **빨간 에러 대신 안내**(`ord-note`). `loadOrders()` 는 설정 전엔 요청을 보내지 않는다.
- 화면 값은 전부 `esc()` (오더 내용·결과·상태 모두 밖에서 온 글). 새로 그리는 함수는 `renderOrders`/`applyOrderList`/`renderOrderNotice` 하나씩만 거친다.
- 테스트: `portal_server` 9)절(규격·화이트리스트·해시·중복·만료·감사·잠금) · `portal_integration` R)절(그리기·승인/거절·Enter·XSS·안내 상태). 가짜 스프레드시트는 `tests/lib/portal_fake_server.js` 가 읽기/쓰기(`appendRow`·`getRange().setValues`)까지 흉내 낸다.

## 서버 (Code.gs)

- POST 전용, 모든 요청에 비밀 키. `doGet` 은 안내 문구만.
- 동작: `ping`, `getTaskLists`, `getTasks`, `addTask`, `completeTask`, `deleteTask`, `getCalendarEvents`(ym), `createEvent`, `deleteEvent`, `loadMemos`, `saveMemos`(baseRev, force), `queue_status`(읽기 전용), `queue_list` / `queue_enqueue` / `queue_decide`(오더함).
- **오더함은 `work/hub-agent/gas/CommandQueue.gs` 와 100% 호환**이어야 한다: 같은 22칸(`CQ_COLS`), 같은 상태값(`PENDING`·`WAITING_APPROVAL`·`RUNNING`·`DONE`·`FAILED`·`REJECTED`·`EXPIRED`·`TIMEOUT_REVIEW`), 같은 `Audit_Log` 11칸, 같은 payload 해시(canonical JSON 의 SHA-256 — 워커 `lib/approval.js` 와 같은 값). 바꿀 때는 양쪽을 같이 고친다.
- 오더함 화이트리스트는 `git_pull`·`toss_sync`·`claude_prompt` 셋뿐(`QQ_TYPES`). `git_push`·`smartstore_api_relay` 는 포털에서 접수하지 않는다. 작업 위치는 `QUEUE_WORKSPACES`(선택, 없으면 `gaegyebu,content-hub,insurance-manager,smartstore-hub`).
- 오더함은 시트를 **쓰기도** 한다 — 쓰기는 `getScriptLock()` 안에서만(못 잡으면 `busy`). 이 잠금은 워커 스크립트의 잠금과 별개라서, 승인은 `WAITING_APPROVAL` 줄만 건드리고 쓰기 전에 그 줄을 다시 읽어 판단한다. 시트 ID 는 여전히 스크립트 속성에만.
- `queue_status` 는 시트·드라이브를 **읽기만** 한다. 시트 ID·파일 ID 는 **스크립트 속성**에만: `QUEUE_SHEET_ID`(Command_Queue 가 있는 스프레드시트), `HEARTBEAT_FILE_ID`(선택). 응답에 ID 는 넣지 않고, 못 읽어도 예외 대신 `state:'unknown'`.
- 토스 동기화 날짜는 드라이브 `가계부/가계부_주식스냅샷.json` 의 `latest.date`(없으면 파일 수정 시각)에서 읽는다 — 가계부 서버와 같은 파일이라 추가 설정이 없다.
- 입력 검사: 월·날짜·시간 형식, ID 길이, 제목 길이. 종료 시간이 없거나 시작보다 빠르면 1시간짜리로.
- 메모 저장: 잠금, rev 확인, 절반 아래로 줄면 `shrink` 거부, 하루 1회 백업(14일), 손상 파일 보호.
- Apps Script 서비스(+)에 **Tasks API** 가 추가돼 있어야 한다.

## 배포

- 앱: `index.html` 을 GitHub 에 올리면 끝.
- 서버: `apps-script/` 에서 clasp 로 배포한다. `clasp push` → `clasp version "설명"` → `clasp list-deployments` 에서 `@HEAD` 가 아닌 배포 id 로 `clasp redeploy <id> -V <새 버전> -d "설명"`. `apps-script/.clasp.json` 은 git 에 안 올린다. 편집기로 할 때는 Code.gs 를 붙여 넣고 배포 관리 → 새 버전. 보안 설정을 처음 할 때만 새 배포 + `createSecretKey` + 옛 배포 보관.
- **`queue_status`·오더함을 처음 배포할 때**: `SpreadsheetApp` 을 쓰므로 권한 승인을 한 번 다시 받아야 한다(배포 관리 → 새 버전 → 승인). 그리고 스크립트 속성에 `QUEUE_SHEET_ID` 를 넣어야 상태등·오더함이 켜진다. 배포 전에는 화면이 `미연결 (세팅 대기)` / 재배포 안내로 남는다(정상).

## 테스트

- `tests/lib/portal_fake_server.js`: 가짜 CalendarApp·Tasks·DriveApp 위에서 실제 Code.gs 실행.
- `portal_integration.test.js` 는 포털 스크립트 전체를 가짜 브라우저에서 돌린다. 시간대 Asia/Seoul 고정.
- 테스트 종류: `portal_server`, `portal_merge`(메모 병합 규칙), `portal_integration`, `prediag`, `memo-safety`. `queue_status`·상태등은 `portal_server` 8)절과 `portal_integration` Q)절이, 오더함은 `portal_server` 9)절과 `portal_integration` R)절이 검증한다(가짜 시트·가짜 heartbeat·가짜 스냅샷).
- `tests/lib/portal_fake_server.js` 의 가짜 스프레드시트는 `getRange().getValues/setValues`·`appendRow`·`insertSheet` 까지 흉내 낸다 — 오더함 쓰기를 실제 Code.gs 로 돌려 시트 배열을 직접 확인한다.
