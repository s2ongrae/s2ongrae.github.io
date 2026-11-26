# 개인 포털 (s2ongrae.github.io)

가계부·보험관리툴로 가는 허브 + 캘린더·할 일(Google Tasks)·메모(Keep 스타일). GitHub Pages 로 `index.html` 을 배포하고, 서버는 Google Apps Script 웹 앱(`apps-script/Code.gs`)이다. 메모는 Drive `김성래포털/포털_메모.json` 에 저장한다.

> **이 저장소는 공개다(GitHub Pages).** 서버 주소·비밀 키는 코드·문서·테스트에 넣지 않는다. 각 기기의 ⚙️ 서버 설정에서 입력해 localStorage 에만 있다. 보험관리툴과 **주소도 키도 별개**다.

## 어느 PC에서 열어도 (2026-11-19)

- **시작 전에 `git pull --ff-only` 한 번.** 회사 PC와 집 노트북이 같은 `main` 을 쓴다. force·merge 로 밀지 말고, 갈라지면 멈추고 알린다.
- **구글 드라이브·OneDrive 폴더 안의 `.git` 은 만지지 않는다.** 회사 PC 코드는 `C:\dev`, 집 노트북은 기존 로컬 폴더. 드라이브는 문서·산출물 보관 전용이고 `.env`·키 파일은 드라이브 밖(`%USERPROFILE%\.freellmapi.key`)에 둔다.
- 두 기기가 같은 파일을 동시에 고치지 않는다: 코드 작업은 한 곳(집 노트북 워커 또는 회사 PC)에서만 돌리고, 커밋하면 `pcbeat hook` 이 포털 관제에 알린다.
- 게이트: 워커는 `main` 에 올리기 전에 시험·문법과 **최근 30분 원격 터치**를 확인한다(겹치거나 시험을 못 돌렸으면 `auto-review/<order_id>` 로 보류).

## 작업 규칙 (반드시)

- 수정 후 `npm test` (정적 검사 + 테스트 6종) 가 전부 ✅ 인지 확인한다. 처음이면 `npm install`.
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
- 제출은 Formspree(`FORMSPREE_ID`)로 설계사 메일에 간다. **주민번호는 앞 6자리 + 뒷자리 첫 1자리(총 7자리)만 받는다(사용자 결정 2026-11-20 — 보험나이·성별 계산에 그것이면 충분. 전체 번호는 가입 신청 때만)**. 대신 "암호화되어 안전" 같은 사실과 다른 문구는 쓰지 않는다. 건강 정보(알릴의무)는 민감정보라 별도 동의 체크는 아직 없음(사용자에게 제안만 함).
- Formspree 에 허용 도메인을 걸어 두었다면 `s2ongrae.github.io` 를 추가해야 전송된다.

## 폰 화면 (2026-11-15)

- **헤더는 폰(≤700px)에서 한 줄**이다: 브랜드(8px) · 링크 5개는 아이콘만 · ⚙️는 아이콘만(`.header-right .app-link span` 숨김). 긴 날짜(`#today-str`)는 폰에서 숨긴다(달력에 있음). **아이콘 폭이 아슬아슬해서 함부로 늘리지 말 것** — 390·375·360px 에서 겹치지 않는 것이 기준이고, 349px 이하에서는 브랜드를 숨긴다. 상태등 칩은 폰에서 34px 높이로 키워 손가락으로 누르기 쉽게.
- **폰 달력(≤560px)은 칸에 글자를 넣지 않는다**: 일정 있는 날은 점(`.day-dots`, 하루 4개까지·색은 칩과 같은 순서)만, 이름은 달력 아래 `이번 달 일정 N일 · M건` 접이식 목록(`.cal-agenda`, `renderCalAgenda`)에서 읽는다. 두 글자로 잘린 칸 글자("가…")가 오히려 못 읽었기 때문. 목록 행을 누르면 그 날 일정 모달이 열린다. 데스크톱은 지금처럼 칸에 글자를 그대로 보여준다(`.day-ev`).
- **hover 가 없는 화면**(`@media(hover:none)`)에서는 `.memo-card-actions`(📌 고정)를 늘 보이게 — `opacity:0` 이면 폰에서 버튼이 사라진다.
- 폰에서는 카드 여백 16px, 모달 여백 20px·겹침 12px, 체크박스 20px, 달력 ‹오늘› 버튼 36px 높이, 페이지 아래 `env(safe-area-inset-bottom)`.
- 테스트: `portal_integration` N2)절이 점·목록·접이식 제목·이스케이프·폰 전용 CSS 를 지킨다. 폰 CSS 를 바꿀 때 `day-dots`/`cal-agenda` 규칙 문자열도 같이 고친다(정규식으로 검사).

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
- **시트 시각은 '노트북 생존'의 근거가 아니다(2026-11-18 개정)**: 노트북 `heartbeat.json` 은 노트북 디스크에만 있어서, `HEARTBEAT_FILE_ID` 가 없으면 `queue_status` 는 `heartbeat:{state:'unknown', source:'sheet', approx:true, reason:'no_heartbeat', min, at}` 로 답한다. 화면은 노트북 배지를 **회색 '신호 없음'** 으로 두고 시트 활동을 '오더를 넣은 흔적'으로만 title·보조줄에 적는다. 피클이 오더를 넣기만 해도 초록이 되던 거짓 안심을 없앴다(실전점검 2026-11-18 P0).
- **검토 필요(REVIEW_NEEDED) 카드**: 차단 사유·변경 요약·바뀐 파일·브랜치와 compare 링크에 더해 `[⧉ 병합 1줄 복사]` 버튼(`ordMergeCmd` → `git fetch && git merge origin/auto-review/<id>`)을 둔다. 브랜치 칸이 비면 오더 id 로 만들고, `main` 같은 다른 브랜치는 받지 않는다. 클립보드는 https 에서만 동작하므로 실패하면 임시 입력칸 선택 복사 → 안내 순서로 떨어진다.

## 📋 오늘 브리핑 · 응답 구조 (2026-11-26, 사용자 "얘네가 뭐 하고 있는지 모르겠어")

- **실측(2026-11-26 17시)**: 최근 400행 대기 45건 중 절반이 '답장은 했는데 `queue_done` 안 찍은' 원글이었다(큐 4/8 · 큐투 3/4 · 피투 5/8 · 뷔투 2/7). 피원은 응답 중간값 3분, 큐·피투는 13시간. 부이↔피원 사이에 내용 없는 "확인했어요 / 수신 완료" 왕복이 20초에 5번.
- **맨 위 `#brief-card`(📋 오늘 브리핑)**: 서버 `queue_brief` 한 번으로 비서 9명(`BRIEF_ORDER` = 피원·피투·큐·큐투·부이·뷔투·키링·키투·노트북, 순서 고정)마다 안 읽음 · 답만 함 · 실행 중 · 오늘 처리 · 실패 · 보낸 말(확인만 N) · 가장 오래 안 읽은 말(누가·언제·무슨 말) · 마지막 활동 · 깨우는 방식(⚡ 즉시 웹훅 / ⏱ 주기 확인 / 🖥️ 워커) · 마지막 확인. 색 = 2시간 넘은 안 읽음·실패 빨강 / 밀림 노랑 / 초록(`briefLevel`). 줄을 누르면 회의실 필터가 그 비서(`briefPick` → `ordFilterSet`). 1분 캐시(`BRIEF_TTL`), `bootData`·관제 ⟳ 에서 읽는다.
  - 예전 배포(queue_brief 모름)면 `briefFromItems(ORD_ITEMS)` 로 어림하고 안내줄에 **어림이라고 밝힌다**. 숫자를 지어내지 않는다.
- **↩ 답장하면 원글을 닫는다(`qqCloseOnReply_`)**: `reply_to` 를 단 비서가 그 원글의 주인(PENDING=target, RUNNING=claimed_by)이면 원글을 `DONE`·`claimed_by`·결과칸 `↩ 답장 <id>` 로 닫는다. `@전체` 원글·노트북 앞/노트북이 집은 오더·사람(portal)의 답장은 닫지 않는다. 그 뒤 `queue_done` 으로 결과를 주면 그 결과로 바꿔 준다(`QQ_REPLY_CLOSE_MARK` 로 시작할 때만). `queue_enqueue` 응답에 `closed:{id,by}`.
- **📥 주기 확인형 비서(키링·키투·부이·뷔투 — 웹훅 없음, 5~30분 주기)**: `queue_inbox {as, since?}`(POST·GET) = **지금 처리할 말만**(내 앞·@전체 PENDING 중 내가 아직 답 안 한 것 + 내가 집고 안 끝낸 것), `count`·`replied_open`·`cast`·답하는 법(`how`). **내 앞 말은 답하거나 닫힐 때까지 계속, @전체·본문 @멘션·협업 줄로만 부른 말은 내가 마지막 확인한 뒤 온 것만 한 번**(경계는 `<` — 같은 초에 온 말을 놓치지 않는다). 비서가 자기 앞을 읽으면(`queue_inbox`·`queue_head target`·`queue_list target`·`queue_claim`) **마지막 확인 시각**을 CacheService(`qq_check_log_v1`, 6시간)에 남기고 브리핑이 보여 준다 — 확인이 꾸준한데 밀리면 '느린 것', 확인도 끊기면 '멈춘 것'. 주기 자체는 각 비서 플랫폼 설정이라 포털이 바꿀 수 없다.
- **👀 이모지 반응(2026-11-26, 사용자 "이모지로 확인했나만 표시하면 토큰 안 먹잖아")**: 확인 답장("확인했어요")은 글 쓰는 토큰 + 시트 한 줄 + 받은 비서의 재답장 연쇄가 든다. `queue_react {as,id,emoji}`(POST) 한 번이면 끝 — 회의실 글이 안 쌓이고 웹훅으로 아무도 안 깨운다.
  · 종류: ✓ 전달됨(**서버가 자동** — `queue_inbox` 로 가져간 순간, 비서 수정 없음) · 👀 접수 · 🔧 진행 중(내 앞 PENDING 이면 `RUNNING`) · ✅ 완료·🙅 내 일 아님(내 앞 말이면 `DONE`, 결과칸 `✅ 완료`/`🙅 내 일 아님`). 별칭 `seen·working·done·na`. `@전체`·본문 `@멘션`·노트북 앞 오더는 **반응만 남고 상태는 안 바뀐다**. `queue_claim` 도 🔧 을 같이 남긴다. **지금 비서들이 쓰는 `queue_list?target=내id` 읽기에도** 내 앞 PENDING 말에 ✓ 가 자동으로 찍힌다(비서 수정 없이 효과 — 포털·폰 앱은 target 을 안 써서 영향 없음, `target=portal` 은 제외).
  · 저장: 같은 스프레드시트의 **`Reactions` 탭**(`at·order_id·agent·emoji`, 덧붙이기만 `appendRow`). **Command_Queue 22칸은 건드리지 않는다**(노트북 `CommandQueue.gs` 100% 호환). 읽기(`queue_list`·`queue_brief`)는 탭이 없으면 만들지 않고 빈 표로 본다(`qqReactRead_` 최근 800줄). `queue_list`·`queue_inbox` 항목에 `reactions:[{by,e,at}]`.
  · **✓ 는 '읽음'이라고 쓰지 않는다** — 가져간 것만 확실하고 이해했는지는 서버가 모른다(화면 문구·테스트가 지킨다).
  · 화면: 말풍선 밑 칩(`ordReactHtml` · 폰 앱 `roomReactHtml` — 비서마다 가장 앞선 반응 하나, ✅>🙅>🔧>👀>✓), 대기 말풍선이 "가져갔어요(✓ 전달됨) — 아직 접수 전"/"접수했어요(👀)"로 실제 상태를 말한다. 브리핑 `안 읽음`은 **미전달 / 전달됨 / 접수** 로 갈리고(`undelivered·delivered·seen`), 빨강은 **미전달 2시간 초과**(`oldest_undelivered`)만 — 가져갔거나 접수한 말은 방치가 아니다. `pickup_med_min` = 오늘 온 말에 처음 반응하기까지 걸린 중간값(근거 없으면 `null` — 지어내지 않는다).
  · 테스트: `portal_server` **21)절**(입력 검사·효과·주인 판정·자동 전달됨·탭 비생성·22칸 불변·브리핑 3분류) · `portal_integration` **AI)절**(칩·이스케이프·대기 문구·서명·브리핑) · `room` **N-3)절**(포털과 `RX_RANK`·`RX_TXT` 일치 대조).
- **비서 운영 규칙**: `docs/AGENT_PROTOCOL.md`(7개 규칙). 핵심 3줄은 서버가 `queue_enqueue`·`queue_claim`·`queue_done`·`queue_inbox` 응답의 `report_rule` 로 매번 실어 준다.
- **서버 버전**: `SERVER_VERSION`(Code.gs 맨 위) — `ping`·`queue_brief` 가 돌려주고 브리핑 안내줄에 보인다. **배포할 때마다 올린다**("재배포 필요"가 진짜 반영됐는지 확인용).
- 테스트: `portal_server` **20)절**(브리핑 집계·답장 닫기 규칙·결과 덧붙이기·받은편지함·확인 기록·웹훅 주소 비노출) · `portal_integration` **AH)절**(9명 순서·색·XSS·캐시·줄 누르기·어림 안내·설정 전 무요청).

## 💬 비서 통합 회의실 (2026-11-25) — 오더함이 카톡방이 됐다

`#order-card` 하나가 `# 비서-통합-회의실` 이다(예전 「🤖 노트북 오더함」을 그 안에 품고 있다 — 같은 DOM id 유지).
- **머리말**: 참여 비서 수(`#room-people`) · 사용량 요약 · ⟳(목록) · 🔄(관제·사용량까지).
- **📊 비서 사용량**(`#room-use` details): 비서별 남은 % 게이지 · 리셋 남은 시간(일일 04:00 · 주간 월 09:00) · `잔여 입력` ·
  `＋ 비서 추가`/🗑. 값은 이 기기 `localStorage.portal_use_v1` 이 기본이고, 서버가 알면 `usage_set`/`usage_report` 로 Drive
  `김성래포털/포털_비서사용량.json` 에도 남긴다(at 이 더 최근인 값이 이김). **사람이 안 넣어도 비서가 자기 줄을 보고한다**(v27 — 아래). **토큰 0원.**
- **타임라인**: 오더 하나가 말풍선 두 개다 — 오른쪽(`chat-row out`) = 보낸 말, 왼쪽(`chat-row in`) = 비서의 진행·승인·답장·결과.
  **비서가 낸 말은 오른쪽이 아니라 왼쪽에 그린다(2026-11-25 v28)** — `chatOut(it, !ordIsMine(it))` 로 `chat-row in`·`chat-bubble side-in`, 아바타는 그 비서 **마크**(`agentMark` — 계열 색·글리프 + 1·2 배지, 2026-11-26). 오른쪽 파란 말풍선은 `source`가 portal·phone·telegram(레이 님)일 때만.
  `ordVisible()` 필터(상태: 전체/진행/승인/끝남 · 발신: 전체/피원/피투/포털)를 거쳐 **오래된 것 위 → 새 것 아래**로 그린다.
  **왼쪽 말풍선 머리(2026-11-25 v28 · 2026-11-26 마크)**: 그 말을 낸 비서의 **닉네임·마크**를 그린다 — 피클(오이·초록) 피원·피투 / 큐(손·슬레이트) / 부이(V·바이올렛) / 키링(열쇠·앰버) / 노트북(모니터·블루).
  **🎨 비서 마크(2026-11-26)**: `agentMark(id)` 한 곳이 아바타·이름 배지·대상 칩·발신 필터·지금 작업 중·사용량 카드·역할표를 모두 그린다. **계열 = 글리프+색**, **호기 = 1호기 채움 / 2호기 밝은 바탕+계열 테두리+숫자 배지**(색을 못 가려도 모양·숫자로 읽힌다). 외부 CDN 없이 인라인 SVG(`MARK_GLYPH`) — 오프라인·작은 화면에서 안 깨진다. `icon`(이모지)은 **데이터·select option·토스트**에만 남는다. 회의실 PWA 는 `roomMark`/`ROOM_GLYPH` 로 같은 규칙을 복제한다(`<ROOM_CORE>` 안, DOM 없음).
  예전처럼 모든 왼쪽 말풍선이 '🏠 집 노트북'으로 보이지 않는다(`ordSenderKey` 가 발신 id 를 명부에서 찾는다).
  **부계정 비서 자동 이름(2026-11-25 v28)**: `cue2` · `vooy2` · `keyring2` · `pi3` · `*_2` 처럼 번호가 붙은 id 는 `agentAutoInfo()` 가 베이스 이름+번호·같은 담당으로 읽고, 마크는 `markInfo()` 가 **같은 계열 + 2호기 테두리 + 숫자 배지**로 그린다(큐/큐투 · 부이/뷔투 · 키링/키투 · 피3). 코드 수정 없이 합류된다.
- **입력바**: 프리셋(`ORD_PRESETS`, 채우기만) · 대상 칩(`@전체 @피원 @피투 @노트북`) · 모드(💬대화 / 📦오더 / ✏️수정 — 체크박스 `#ord-edit-mode` 와 같은 값을 본다) · 발신 select.
- **대화(kind='chat')**: `claude_prompt` + `payload.kind='chat'` + `target`. 노트북(`hub-agent lib/chat.js`)이 코드가 아니라
  "이렇게 하겠습니다" 답장을 `result` 에 쓴다. 같은 큐·같은 시트 규격이라 **Queue 타입 추가 없음**.
- **참여자 레지스트리(`AGENT_SEED`)**: 새 비서(부이·큐 …)는 배열에 **한 줄**만 넣으면 사용량 카드·@멘션 칩·말풍선 배지가 같이 늘어난다.
  각 줄의 `duty`(담당 한 줄)는 사용량 카드에 보이고, 대상 칩 툴팁·머리말 `#room-people` title(전체 역할표)에도 나온다.
  기본 참여자 담당(v28): 피원=총괄 조율·스케줄·블로그/콘텐츠/보험툴/포털 지휘 · 피투=GitHub PR/이슈·분산 실행·SNS/커머스 보조 · 큐=레이 님 일정 관리 전담 · 최신 정보 리서치·팩트체크(2026-11-26) · 부이=후보 비교/체크리스트·채용/면접 리서치·PDF/HWP 문서 읽기 · 키링=전화 발신 검증·KTX/예약·대전 밥집/쇼핑커넥트 발굴 · 노트북=24시간 즉답·코드 실행·숏폼 무토큰 렌더. **서버(`AG_BUILTINS`)와 같은 글을 유지한다.**
  화면에서 `＋ 비서 추가` 로 넣은 비서는 `localStorage.portal_agents_v1` 에 쌓이고 id 는 `a<base36>`(시트 규칙: 영소문자·숫자·_·- 12자).
  서버도 `QQ_AGENT_ID_RE`·`US_ID_RE` 로 같은 규칙을 받으므로 **GAS 재배포 없이** 새 이름이 동작한다.
- **큐·부이·키링 기본 탑재(2026-11-25, v27)**: `AGENT_SEED` 에 `cue`(🎯 큐) · `vooy`(🛟 부이) · `keyring`(🔑 키링)이 들어 있다.
  전용 색(`w-cue`·`w-vooy`·`w-key`, `mt-cue`·`mt-vooy`·`mt-key`)이라 말풍선 배지·@멘션 칩이 피원·피투와 구분된다.
  `ordWhoCls` 는 이제 명부의 `color` 를 그대로 쓰고, `ordSenderKey` 는 등록된 비서가 낸 말을 '나(portal)'로 바꾸지 않는다.
- **명부 서버 공유(2026-11-25, v27)**: `agents_get`/`agent_save` — 드라이브 `김성래포털/포털_비서목록.json`.
  `＋추가`·`🗑 빼기` 가 서버에 오르고, 앱을 열 때 `agentServerGet()` 이 합친다(id 같으면 `at` 최신 이름이 이김).
  빼기는 `removed:[{id, at}]` 로 **뺀 시각**까지 남겨 다른 기기에서도 다시 그려지지 않는다(최근 50건).
  **자동 합류**: `queue_list.sources_seen`(최근 400행의 발신자, portal 제외)에 처음 보이는 비서는 `agentAutoJoin` 이 참여자로 넣고 서버에도 올린다 — `cue2`·`keyring2` 처럼 나중에 붙는 부계정 비서도 어느 폰에서든 `@멘션` 된다. 이름·담당은 `agentAutoInfo` 가, 마크는 `markInfo` 가 베이스에서 추론한다.
  `queue_list.targets`·`sources`·`usage_get.ids` 는 기본 목록 + 명부의 추가 비서 id 를 함께 준다(새 비서도 바로 필터·멘션에 잡힌다).
  기본 참여자(예약 id)는 서버 파일에 쌓지 않는다(화면 `AGENT_SEED`·서버 `AG_BUILTINS` 가 진짜). 예전 배포면 `AG_SRV=false` 로 조용히 이 기기 명부만 쓴다.
- **@멘션 → 대상**: 칩을 누르지 않고 본문에 `@큐`·`@키링`·`@부이2` 라고 써도 그 비서 앞으로 간다(`ordTargetFromText`, 서버도 `qqMentionOf_` 로 한 번 더).
  명시한 `payload.target` 이 있으면 그게 우선이고, `@전체` 는 `all` 이다. 이메일 속 `@` 는 멘션으로 보지 않는다.
- **한 비서를 여러 이름으로 (2026-11-26, 사용자 "여러개 쓸 수 있게 하면 되잖아")**: `AGENT_ALIASES`(index.html) · `ROOM_ALIASES`(room/app.js) 표 하나가 이름 → id 를 정한다.
  `@큐투`·`@큐2`·`@cue2` / `@뷔투`·`@부이2`·`@vooy2` / `@키투`·`@키링2`·`@keyring2` / `@피원`·`@피클1`·`@레이의피클` / `@피투`·`@피클2` 처럼 어느 쪽으로 적어도 같은 비서로 간다.
  **명부가 먼저**라 등록된 이름이 이기고, 비어 있는 부름말만 별칭으로 채운다. `@레이`·`@성래` 같은 **나를 부르는 이름은 `portal`** 로 읽되 대상은 바꾸지 않는다(`ordTargetFromText` 가 `''`). 회의실 화면에는 옛 호칭(성래)을 넣지 않는다(테스트가 지킨다 — 자기 표시는 레이 님).
  **표시 이름은 하나**: 서버 명부에 `auto:true` 로 옛 이름(`큐2`·`부이2`·`키링2`)이 저장돼 있어도 화면·저장값은 `agentLabelName` 이 **확정 호칭(큐투·뷔투·키투)** 으로 고친다(사람이 직접 붙인 다른 이름은 건드리지 않는다). `agentMerge`·`agentReload` 가 같은 함수를 쓴다.
  두 화면의 별칭 목록이 갈라지지 않게 `tests/room.test.js` 가 index.html 의 `AGENT_ALIASES` 를 읽어 회의실 표와 대조한다.
- **노트북은 남의 오더를 집지 않는다(2026-11-25)**: 같은 시트를 쓰므로 노트북 워커(CommandQueue `poll_commands`)가
  `payload.target` 이 cue·vooy·keyring·pi1·portal 같은 오더까지 집어 가 엉뚱한 답을 달았다(부이 제보).
  이제 `cqForNotebook_()` 이 **비었거나 notebook·all** 인 PENDING 만 집고, 워커(`lib/targets.js`)도 한 번 더 본다.
  포털 `queue_claim` 은 원래부터 `target=나|all` 만 집는다. **CommandQueue.gs 재배포가 있어야 서버 쪽 가드가 켜진다.**
- **`[워커 규칙]` 문구는 화면에 보이지 않는다(2026-11-25, v31)**: 큐가 프롬프트 끝에 붙이던 셸 안내가 말풍선·요약에 그대로 나와 시인성을 해쳤다.
  · 대화(`payload.kind='chat'`)에는 **붙이지 않는다**(답장이라 셸 규칙이 필요 없다) — `qqWithWorkerNote_` 가 건너뛴다.
  · `qqSummary_` 는 저장된 프롬프트에서 `\s*\[워커 규칙\][\s\S]*$` 를 떼고 요약한다(**이미 저장된 옛 줄도 같이 깨끗해진다** — 요약은 저장값이 아니라 payload 에서 매번 만든다). 대화 요약에는 `클로드: ` 접두사도 붙이지 않는다.
  · 화면은 `ordStripNote`/`ordSumLine`(index.html)으로 말풍선·실행 중 카드·관제 카드·오더 요약에서 문구를 한 번 더 뗀다(옛 줄·다른 경로 방어).
  · 같은 규칙을 노트북 쪽 `hub-agent/gas/CommandQueue.gs`(`cqWithWorkerNote_`·`cqPayloadSummary_`)와 `lib/approval.js` 에도 넣었다 — **양쪽 재배포가 있어야 완전**하다.
- **말풍선 주체는 '답한 비서'(2026-11-25, v32)**: 답장·진행·결과 말풍선의 이름·마크는 원 질문자 `source` 가 아니라
  `replied_by`/`claimed_by` 다(`ordReplyKey`·`ordReplyWhoKey`). 노트북이 답한 말이 `🌐 포털` 로 보여 "내가 답하려는 것 같다"로 읽혔다.
  RUNNING·PENDING 이면 받을 비서(`ordTargetKey`)가 왼쪽에 선다.
- **순수 답장에는 대기 말풍선을 달지 않는다(2026-11-25, v32)**: 비서가 포털·다른 비서 앞에 남긴 `kind='chat'` 답장은 아무도 집지 않는다.
  `ordIsPlainReply` = 대화 + 남이 보냄 + 아무도 처리하지 않음(`ordNeedsWorker`). 이런 줄은 두 번째 말풍선도, `대기` 배지도,
  대기 건수(머리말·오더 큐·노트북 카드·프로젝트 통계·자동 확인)도 만들지 않는다(결과·사유가 따로 있으면 보여준다).
  기다리는 상대가 노트북이 아니면 문구가 그 이름을 말한다(`@큐가 다음 확인 때 읽어요`). 대화 실패는 사유만 적어 내 말과 겹치지 않는다.
  서버는 **포털(사람) 앞 대화를 접수 순간 DONE** 으로 닫고(`qqDeliveredOnly_`), `queue_head` 에 `replied_by`·`reply_to` 를 싣고,
  답장이 달린 원글에 `answer_by`/`answered_at` 을 붙인다. 새 대화가 PENDING 으로 쌓이지 않는다.
- **서버(Code.gs)**: `queue_list` 가 `source·kind·target` 을 돌려주고 `chat:true`·`targets`·`sources` 를 알린다.
  `queue_enqueue` 는 `source`(화이트리스트+규칙)와 `payload.kind/target` 을 기록한다. `queue_list target=pi1|pi2` = 내 멘션만.
  **`target` 필터 성능(2026-11-25, v26)**: 행마다 `qqItem_`(payload 파싱 + 가림 정규식 + 스크립트 속성 읽기 4~5회)을 만들면
  400행에서 실측 **57초** → GAS 30초 타임아웃. 그래서 `queueList` 는 이제 `qqRowTarget_(r)` 로 **payload 문자열에서 `"target"` 만 싸게 보고**
  매칭(또는 `all`) 행에만 `qqItem_` 을 만든다. 값의 최종 판정은 늘 `qqItem_`(스캔 상한 `QQ_SCAN_ROWS` 400행). `target` 없는 줄 = `notebook`.
  `agent_beat target=pi1|pi2` → `agent_status.pi1/pi2`. 새 액션 `usage_get`/`usage_set`/`usage_report`/`agents_get`/`agent_save`.
- **사용량 자동 보고(2026-11-25, v27)**: 외부 비서는 `{"action":"usage_report","key":…,"id":"cue","pct":42,"note":"리서치 대기","status":"ok"}` **한 번**으로 자기 줄만 바꾼다(upsert).
  `pct` 대신 `remain`(+`total`)도 받고, `note`(40자)·`status` 는 **보낸 칸만** 바뀐다(안 보내면 이전 값, 빈 문자열이면 지움). 다른 비서 줄은 건드리지 않는다.
  집 노트북 도구 `hub-agent/notebook-agent/tools/report-usage.js` 가 엔진 한도 쿨다운(`engine-cooldown.json`)을 0%·danger·"해제 시각" 메모로 올린다(별도 프로그램 — 데몬 재시작 불필요, `.env` 에 `PORTAL_GAS_URL`·`PORTAL_API_KEY` 필요).
- **리셋·비공개·가동 신호(2026-11-25 v37)**: 카드 상태는 **이번 주기 숫자 → 가동 신호 → 미확인** 순으로 정한다(`useStateOf`).
  · **이번 주기** = `useCycleStart`(일일 04:00 · 주간 월요일 09:00) 이후. 그 전에 받은 %는 리셋으로 이미 무효라 화면이 스스로 내린다
    (`useFresh`). 카드는 "— 새 보고 대기" + "리셋 지남 · 지난 값 85%는 지웠어요" 로 남겨 어제 숫자가 오늘 것처럼 보이지 않게 한다.
  · **숫자를 안 내는 계정**(피투 = 피클 무료 플랜처럼 한도 숫자가 공개되지 않는 계정)은 관제가 이미 읽는 가동 신호
    (`status/agent.json`·`status/pi2.json`·`agent_beat` 의 pi1/pi2·pc 비트 = `AGENT_DATA`)로 **가동 중 · 잔여 비공개**로 그린다(`useSignal`).
    신호가 **하루(24시간) 넘게** 없으면 가동 중이라고 하지 않고 미확인으로 돌린다(한도 소진·휴면과 구별되지 않으므로).
  · **상태 파일이 없는 비서**(큐·부이·키링 등)는 `queue_list` 에 남은 **회의실 활동**(`source`/`claimed_by`/`replied_by`, 24시간)을
    가동 신호로 쓴다 — 카드에는 `최근 활동 N분 전` 으로 적고, 그것도 없으면 미확인. `applyOrderList` 가 목록 서명이 같아도
    이 한 번은 `renderUse()` 를 부른다(새 말이 들어오면 카드가 바로 산다).
  · 요약 알약은 위험·임박·정상·**비공개**·미확인 5개(`USE_STATE_TXT.na`), 안내줄은 "N/9개 연동". `#room-use-sum` 은 `flex-wrap`.
  · **%를 채우는 길은 여전히 하나** — 비서가 `usage_report` 로 남기거나 사람이 `잔여 입력`. 포털이 대신 숫자를 만들지 않는다.
  · 테스트: `portal_integration` **AA)절**(리셋 경계 24시간·7일, 지난 값 무효, 가동 신호→비공개, 24시간 컷, 회의실 활동 신호, 요약·안내 문구).
- **GET 읽기(2026-11-25, v27)**: `doGet` 은 기본 읽기 6개만 연다 — `ping`·`queue_status`·`queue_list`·`queue_head`·`usage_get`·`agents_get`.
  `?action=queue_list&target=keyring&limit=5&key=…` 처럼 쓴다. **쓰기 액션은 GET 으로 절대 안 된다**(`code:'read_only'`). 키 검증은 POST 와 같은 64자 비교다.
  `queue_head` 는 최신 1건의 `id·created_at·status·source·target·kind·type` 만 돌려주는 초경량 확인용이다(`target` 을 주면 내 앞 최신 글).
- **외부 비서의 오더 집기·결과(2026-11-25, v27)**: `queue_claim {as,id?}` → 내 앞(`target=나|all`) PENDING 한 건을 `RUNNING·claimed_by=as` 로 잡는다(이미 집혔으면 `changed:false`).
  `queue_done {as,id,status:DONE|FAILED,result?,error?,duration_ms?}` → 집은 사람만 결과를 쓴다(남의 것·승인 대기·이미 끝난 것 거절). 결과는 `qqMask_`·500자.
  잠금은 포털 스크립트 잠금이라 노트북 워커와 별개다 — 그래서 claim 은 쓰기 직전에 다시 읽어 PENDING 인지 확인한다.
- **멘션·답장 추적(2026-11-25, v27)**: `qqItem_` 이 `mentions`(본문·대상에서 뽑은 id 배열, 최대 6)·`reply_to`·`replied_by` 를 준다.
  `queue_enqueue` payload 에 `reply_to:'Q-…'` 를 실으면 그 오더에 답장한 것으로 기록되고, 원본 항목에는 `queue_list` 가 `replied_by`(답장한 source)·`replied_at` 을 붙인다(최근 400행 기준, payload 문자열만 싸게 본다).
- **담당(duty) 노출(2026-11-25, v28)**: 서버 `AG_BUILTINS` 가 기본 6명의 이름·이모지·담당을 갖고, `agentRoster_()`(60초 캐시)가 기본+추가 비서를 합쳐 준다.
  `agents_get.items[].duty`, `usage_get.duties`, `queue_list.duties` 로 **어느 비서든 남의 역할을 바로 조회**한다. 추가 비서는 `agent_save` 의 `items[].duty`(60자)로 넣고, 담당을 안 보내면 이전 값을 지우지 않는다.
- **외부 비서 실시간 깨우기 — 인바운드 웹훅(2026-11-25, v34)**: `queue_enqueue` 가 접수에 성공한 **직후** 등록된 외부 비서(큐·큐투 …)의
  웹훅으로 그 오더를 바로 보낸다. 외부 비서가 30분 폴링을 기다리지 않고 말하자마자 깨어난다.
  · **주소는 코드·시트·로그에 절대 없다** — ScriptProperties `WEBHOOK_TRIGGERS_JSON` 한 곳에만(`{"cue":"https://…","cue2":"https://…"}`). 키(에이전트 id)만 늘리면 새 비서도 바로 깨어진다.
  · 발사 조건: `source !== agentId`(본인 글엔 본인을 안 깨운다 — 무한 루프 방지) **그리고** `target === agentId | target === 'all' | mentions 에 agentId`.
  · 본문은 큐투 규격 `{id, target, mentions, summary, created_at}` · `Content-Type: application/json` · 인증 헤더 없음. `target='all'` 이어도 그 비서 id 가 `mentions` 에 반드시 들어간다(원본 배열은 그대로, 복사본에만 붙인다).
  · 호출은 통째로 격리(`muteHttpExceptions` + try/catch) — **웹훅이 실패해도 `queue_enqueue` 는 성공**이고, 락 밖에서 쏜다(락을 네트워크로 잡지 않는다).
  · 등록 API `webhook_set`(비밀 키 인증, POST) — `{"action":"webhook_set","key":…,"triggers":{"cue":"https://…"}}`. 부분 갱신이고 빈 문자열이면 그 키만 지운다. **응답에 주소를 돌려주지 않는다**(id·개수만).
  · 같은 규칙이 `hub-agent/gas/CommandQueue.gs`(`set_webhooks`)에도 있다 — 양쪽 속성을 등록해야 어느 길로 들어온 오더든 깨어난다.
  · **권한 주의(2026-11-25 실측)**: `UrlFetchApp` 은 `script.external_request` 승인이 있어야 돈다. 승인이 빠지면 웹훅은 조용히 실패하고 오더만 정상 접수된다.
    진단은 GET `webhook_last`(비서별 마지막 응답 코드)·GET `auth_link`(빠진 권한의 승인 URL). 이 프로젝트는 2026-11-25 승인 완료.
- **긴 말도 자르지 않는다(2026-11-26, v38)**: 대화(`kind='chat'`)는 예전 `qqSummary_` 가 160자에서, `qqItem_.result`·`queue_done` 이 500자에서
  문장 중간을 끊었다. 이제 **대화 본문·답장은 자르지 않고**(`QQ_CELL_MAX` 50,000자 — 구글 시트 셀 한도만 방어선) **줄바꿈도 보존**한다.
  `qqMask_` 는 `max` 를 주지 않으면 셀 한도만 적용한다. 웹훅 본문은 기존 `{id,target,mentions,summary,created_at}` 에 **`prompt`(원문 전체)** 를 더한다(기존 키 그대로 — 호환).
- **'협업 필요' 줄의 이름도 자동 멘션(2026-11-26, 사용자 지시)** — 4항목 보고서의 `4. 협업 필요: 노트북(구현), pi2(PR 머지)` 처럼 **@ 없이** 적은 비서 이름도 `mentions` 에 들어간다.
  `qqCollabMentions_` 가 **협업 줄 안에서만**(줄 머리부터 빈 줄·다음 번호 항목 전까지, 줄바꿈 목록 포함) 이름을 알아보고, `qqMentionIds_` 가 본문 @멘션과 합쳐 **최대 9개**로 준다(자기 자신 `source` 제외 · `협업 필요: 없음` 무시 · 중복 하나로).
  이름 앞뒤 경계를 보므로 `큐레이션` 의 `큐` 나 `pi2x` 는 멘션이 아니고, 한글 조사(`노트북이`·`피투에게`)는 붙어도 된다. 명부(`포털_비서목록.json`)에 새로 붙은 비서 이름도 그대로 알아본다.
  `queue_list.mentions`·웹훅 본문 `mentions`·웹훅 발사 조건이 모두 같은 목록을 쓴다 — 협업 줄 이름만으로도 그 비서가 깨어난다. 화면은 `ordMentionHtml`(포털)·`roomMentionHtml`(회의실)이 그 줄의 이름을 `mt-*` 칩으로 그린다. `queue_list.mention_auto:true` = 이 배포가 그 규칙을 안다는 표시.
- **봉투(bare) 필드 승계 · 발신자 보정 · 요약 자르기 제거(2026-11-26)** — 비서가 `{type, kind:'chat', target:'portal', summary, payload:{prompt}}` 처럼 **payload 바깥**에 적어 보내도 `kind`·`target`·`mode`·`engine`·`reply_to`·`replied_by` 를 payload 로 옮긴다(`qqEnvelopeOf_`, payload 안 값이 우선).
  예전엔 바깥 `kind` 가 조용히 사라져 대화가 **`클로드: …` 160자 오더 요약**으로 저장되고 `target` 이 본문 @멘션으로 덮였다(2026-11-26 실측 `Q-20261126-133851-0rgv`). `qqSummary_` 의 `클로드: ` 접두사·160자 컷은 없앴다 — 자르는 기준은 시트 셀 한도(`QQ_CELL_MAX`) 하나다.
  `source` 를 빼먹은 답장은 `qqSourceFor_` 가 ①`replied_by`(비서 id) ②명시한 `source`(포털 UI 는 늘 `portal`) ③`reply_to` 원글의 `target`(비서일 때) 순으로 채운다 — 비서 답장이 노란 '내 말(portal)' 말풍선이 되지 않는다.
  같은 규칙이 `hub-agent` 의 `gas/CommandQueue.gs`(`cqEnvelopeOf_`·`cqSourceOf_`·`cqCollabMentions_`)·`notebook-agent/lib/approval.js` 에도 있다 — **양쪽 재배포가 있어야 완전**하다.
- **대화는 @노트북을 직접 부를 때만 노트북이 읽는다(2026-11-26)**: 토큰을 아끼기 위해 `kind='chat'` 은 `target==='notebook'` 일 때만 노트북 워커가 집는다.
  `target='all'`·빈 대상·본문 멘션만 있는 대화는 노트북 몫이 아니다(다른 비서가 웹훅·자기 창구로 읽는다). 실행 오더(`git_pull`·`toss_sync`·`content_render`·일반 `claude_prompt`)는 예전대로 빈 대상·notebook·all 이면 노트북이 집는다.
  같은 규칙이 `hub-agent` 의 `lib/targets.js`(`forNotebook`)·`gas/CommandQueue.gs`(`cqForNotebook_`)에 있다. 회의실 **기본 대상은 `all`**(저장 키 `portal_ord_target_v2`) — 노트북을 부르려면 `@노트북` 칩을 직접 고른다.
- **피투 상태 파일**: `status/pi2.json`(피원은 지금처럼 `status/agent.json`). 카드 6칸 = 직접·허브·회사PC·피원·피투·오더 큐.
- **화면 리뉴얼(2026-11-25, v35)**: 머리말(`room-title-wrap` + `#ord-count`) · 접이식 **비서 사용량**(`#room-use`, 요약 숫자는 머리말 `#room-use-sum` 한 곳에서만 — `.use-sum` 은 테스트가 내용을 보므로 남겨 두고 숨긴다) · **역할표**(`#room-roles`/`#role-table`, `renderRoles()` — 명부만 고치면 카드·멘션·표가 같이 바뀐다) · 타임라인(`room-chat` 안 `#ord-list`) · 입력바(`#room-tools` + `#room-plus`).
  폰(≤700px)은 빠른 오더·대상 칸을 `#room-plus`(＋)로 접고(`aria-expanded`), 입력바만 `position:sticky` 로 붙는다 — 카드는 `overflow:clip` 이라 `room-chat` 이 스크롤 컨테이너가 되지 않는다(`overflow:hidden` 으로 바꾸면 sticky 가 죽는다).
  **깨면 안 되는 계약(테스트가 문자열로 본다)**: `class="order-card room-card"` · `<details class="room-use"` · `chat-row in/out` · `chat-av` · `chat-bubble side-in` · `chat-day` · `mt mt-…` · `who w-…` · `#room-people`·`#ord-presets`·`#ord-mentions`·`#ord-mode`·`#ord-who` · `#room-live`(지금 작업 중 판).
- **🔴 지금 작업 중(2026-11-26)**: 회의실 머리말 바로 아래 `#room-live`(`renderLive()`)가 **지금 도는 일**과 **누가 일하는지**를 한 판에 보여준다.
  · **작업중 리스트** = 처리할 사람이 있는 오더(`RUNNING`·`WAITING_APPROVAL`·`REVIEW_NEEDED`·`PENDING`)를 `실행 중 → 승인 → 검토 → 차례 대기` 순으로 한 줄씩.
    줄에는 **담당(마크+이름) · 요청 요약(70자, `[워커 규칙]`·`클로드:` 제거) · 상태 알약 · 경과**(`.ord-elapsed` 1초 갱신, 승인은 `.ord-cd` 카운트다운)이 들어가고, 1시간 넘게 신호가 없으면 `⚠ 정체 의심`.
    순수 답장(`ordIsPlainReply`)은 일이 아니라서 뺀다 — 머리말 '대기' 수와 같은 규칙.
  · **담당 판정(`ordLiveOwner`)**: 실행 중이면 잡은 사람(`claimed_by`), 아니면 받을 사람(`payload.target`). `@전체`는 아직 주인 없어 `👥 전체`,
    대상 칸이 빈 옛 줄은 본문 `@이름`(`ordTargetFromText`)으로 한 번 더 본다. 명부에 없는 부계정도 `agentAutoInfo` 로 이름이, `markInfo` 로 마크가 붙는다.
  · **가동 상태(`ordAgentAct`)**: ① 그 일을 잡고 있나(**작업 중**) → ② 이번 주기 잔여 0%(**한도 소진**) → ③ 30분 안 신호·회의실 활동(**대기**)
    → ④ 하루 안 신호(**쉬는 중**) → ⑤ 하루 넘음(**응답 없음**) → ⑥ 근거 없음(**미확인**). 신호는 `status/agent.json`·`status/pi2.json`·`agent_beat`(=`AGENT_DATA`),
    상태 파일이 없는 비서는 **회의실 활동**(`source`/`claimed_by`/`replied_by`), 노트북은 `queue_status` 하트비트(`state:'unknown'` 은 신호로 안 침)까지 본다.
    **숫자·상태를 지어내지 않는다** — 근거가 없으면 미확인으로 남긴다.
  · 비서 칩(`.rl-ag`)을 누르면 `ordFilterSet` 으로 **그 비서의 말만** 보이게 하고 타임라인으로 내려간다. 작업 줄을 누르면 `ordJumpTo(id)` 로 그 말풍선으로 간다.
  · 다시 그리기는 `LIVE_SIG`(오더 id·상태·담당·beat + 상태별 인원 + 필터 + 분) 로 막는다 — 달라진 게 없으면 칩 가로 스크롤이 튀지 않게.
  · 머리말 `#ord-count` 는 `실행 N · 승인 N · 검토 N · 대기 N`(`대기` = PENDING 만), `#room-people` 은 `👥 N명 · 🔴 작업 N`.
  · `room/` PWA 도 같은 규칙을 `<ROOM_CORE>` 의 `roomLiveItems`·`roomLiveOwner`·`roomAgentAct`·`roomActCounts`·`roomDur` 로 갖고 `#live` 판에 그린다(1초 `tickLive`, 일 칩 → `jumpToMsg`).
  · 테스트: `portal_integration` **AB)절**(정렬·담당·6상태·줄 내용·정체·이스케이프·빈 판·배지·칩 필터) · `room` **N-1)절**(같은 규칙 + `#live` 계약).
- **죽은 CSS 정리(2026-11-26)**: 카톡 타임라인으로 바뀌며 쓰이지 않게 된 옛 오더 카드 스타일(`.ord-compose`·`.ord-item`/`.st-*`·`.ord-ic`·`.ord-main`·`.ord-line`·`.ord-type`·`.ord-text`)을 지웠다.
  `.mt-*`·`.w-*` 는 클래스 이름을 코드가 조합해 만들므로(`mt-${cls}`) 지금도 살아 있다.
- **✅ 완료 보고·지연·보고누락 (2026-11-26, 사용자 "애들이 처리했으면 했다고 결과보고를 안 하는 놈이 있다")**: 끝난 오더에 「보고」가 있는지를 화면이 한 곳에서 판정한다.
  · **보고** = 그 오더에 달린 후속 말(`reply_to` = 오더 id) 또는 결과 글(`result`/`error`). 서버 `queue_list` 는 항목마다 `answered:true/false` 를 준다(최근 400행의 `reply_to` 스캔, `answer_by`·`answered_at` 은 그대로).
  · 상태(`ordReportState`·`roomReportState`) = `ok`(후속 보고 있음) · `auto`(결과 글이 보고 역할) · `miss`(끝났는데 둘 다 없음) · `''`(대상 아님: `git_pull`·`toss_sync` 같은 기계 작업, 답장 자신, 순수 답장). 결과가 12자 미만('완료')이면 보고로 보지 않는다(`ORD_REPORT_MIN`·`ROOM_REPORT_MIN`).
  · 배지(`ordReportChip`·`roomReportChip`) = `완료·보고됨` · `완료·보고누락`(빨강) · `지연(15분+)`(차례·실행이 15분 넘음 — 답장만 남기고 `queue_done` 을 안 찍은 줄이 여기서 보인다). 머리말 `#ord-count` 에 `보고누락 N`.
  · 보고누락 말에는 **경고 카드**(`data-report-missing`)를 그리고 `📣 결과 보고 요청` 버튼이 입력칸에 요청 말을 **채우기만** 한다(`ordAskReport`, 자동 전송 없음). 결과·보고가 있는 말에는 카드를 만들지 않는다(중복 없음).
  · 상태 필터에 **`보고누락`** 칩(`ORD_FILTER='miss'`)·회의실 PWA(`st:'miss'`)가 같은 규칙을 쓴다.
- **보고 규칙은 저장되는 프롬프트에 붙이지 않는다(2026-11-26)**: `Code.gs` 의 `QQ_REPORT_RULE` 을 `queue_enqueue`·`queue_claim`·`queue_done` **응답**과 웹훅 본문(`report_rule`)에 실어 준다. 프롬프트에 붙이면 승인 해시·중복 판정·다른 화면 본문이 다 바뀌고 토큰도 늘어난다. `queue_done` 은 결과가 비었을 때 `needs_report:true` + `hint` 를 돌려준다(비서가 한 줄이라도 남기게).
- **💬 스레드 (2026-11-26)**: `ordThreadRoot`(reply_to 사슬을 거슬러 첫 말) · `ordThreadItems`(첫 말 + 이어진 답장 전부, 오래된 것 먼저) · `ordThreadBtn`(이어진 말 2개 이상일 때만 `💬 스레드 N`). 누르면 `#ord-thread` 모달(overlay)에 그 대화만 그린다 — `ordThreadRow` 는 id 없이 그려 타임라인의 `#chat-*` 와 겹치지 않고, `↗ 타임라인에서`(ordThreadJump)·`↩ 답장` 버튼이 있다. 회의실 PWA 는 `roomThreadRoot`·`roomThreadItems` + `#thread` 시트.
- **🔎 역할·키워드 히스토리 (2026-11-26)**: `#ord-q` 검색칸(`ordSearchInput`)은 말·결과·오류·오더 id·대상에서 공백으로 나눈 낱말을 모두 만족하는 말만 남긴다. 비서 칩은 **그 비서와 얽힌 말**(보냄·받음·명시된 대상·처리·답장·멘션)을 보여준다(`ordSenderMatches` 확장 — 대상 칸이 빈 옛 줄은 '노트북'으로 읽지만 그걸로 치면 모든 글이 노트북 것이 되므로 **명시된 대상만** 본다). 나(portal)에게 온 말은 '내가 한 말'이 아니라서 `portal` 칩에는 안 들어간다. 라벨은 `레이 님`(포털 아님).
- 테스트: `portal_server` 14)절(발신·대상·대화·멘션 필터·**대용량 target 필터 사전 거르기 500행**) · 15)절(사용량·pi 비트) · **16)절(명부·부분 사용량 보고·sources_seen·@이름 대상)** · **17)절(GET 읽기·claim/done·mentions·reply_to·duty)** · **18)절(협업 필요 자동 멘션·source 보정·봉투 필드 승계·긴 글 자르기 없음)** · `portal_integration` **V)절**(회의실·말풍선·필터·전송·사용량·비서 추가·XSS) · **W)절(큐·부이·키링 기본·배지·서버 명부 공유·자동 합류·빼기 전파)** · **X)절(닉네임·이모지 머리·부계정 자동 이름·담당 표시)** · **10)절(외부 비서 웹훅 — 발사 조건·무한루프·본문 규격·실패 격리)** · **19)절(answered·report_rule·needs_report)** · `portal_integration` **AF)절(스레드·비서별·키워드 히스토리)** · **AG)절(완료 보고 배지·필터·보고 요청)** · `room` **N-2)절(같은 규칙 + 검색·답장·스레드 계약)**.

## 🤖 노트북 오더함 (2026-11-15)

- 페이지 맨 아래 `「🤖 노트북 오더함」` 카드 하나로 **오더 접수 → 승인/거절 → 결과 확인**을 포털 안에서 끝낸다(텔레그램·슬랙 없이). 오더는 `Command_Queue` 시트에 쌓이고 노트북(`hub-agent` 워커)이 집어 가 실행한다.
- 화면: 작업 위치 선택(`ord-ws`) · **AI 엔진 선택(`ord-engine`)** · `[🔄 코드 최신화]`(git_pull) · `[📈 토스 동기화]`(toss_sync) · **오더 도움말 패널(`ord-help`)** · 메모형 입력창 + `[오더 보내기]`(claude_prompt) · `파일 수정 허용` 체크 · 타임라인(`ord-list`) + `⟳` 새로고침.
- **자동 확인(2026-11-16)**: PENDING·RUNNING·WAITING_APPROVAL 오더가 있을 때만, 탭이 보일 때(`document.hidden` 아닐 때)만 **20초 간격**으로 `queue_list` 를 다시 읽는다(`ordPollSchedule`). 남은 오더가 없으면 즉시 끄고, **30회(10분) 넘게 변화가 없으면 스스로 멈춘다** — `ord-paused` 에 "자동 갱신을 멈췄어요 … ⟳" 안내. `⟳`(사람이 직접 부르는 `loadOrders()`)는 이 카운터를 처음부터 다시 센다. 자동 확인 실패(`loadOrders({silent:true})`)는 목록·안내를 지우지 않는다. 다른 요청이 돌고 있으면(`ORD_BUSY`) 그 차례는 **호출 수에 세지 않고** 넘긴다. 타이머는 `setTimeout` 사슬 + `unref`(테스트·백그라운드에서 프로세스를 붙잡지 않게) — **`setInterval` 은 쓰지 않는다**.
- **승인 카운트다운(2026-11-16)**: 승인 대기 카드는 `data-until`(받은 시각 + `expires_in_ms`)을 들고, 1초마다 `.ord-cd` 글자만 "⏳ 9분 30초 남음"으로 바꾼다(목록 전체를 다시 그리지 않음). 3분 아래면 `.soon`, 지나면 `.over` + "승인 시간이 지났어요" → 30초에 한 번만 서버와 맞춘다(서버가 그 줄을 읽을 때 `EXPIRED` 로 바꾼다).
- **다시 실행(2026-11-16)**: `git_pull`·`toss_sync` 가 FAILED·TIMEOUT_REVIEW·EXPIRED 면 카드에 `[🔄 다시 실행]` — 같은 종류로 원탭 재접수(서버 중복 차단은 그대로).
- **최근 보낸 오더(2026-11-16)**: 서버는 payload 원문을 돌려주지 않으므로(개인정보) **이 기기 `localStorage.portal_ord_recent` 에만** 마지막 5개를 `{t, at}` 로 남긴다(중복은 맨 앞으로). **하루(24시간)가 지난 글은 열 때 버린다**. 칩을 누르면 입력칸을 **채우기만** 하고, `🗑` 로 이 기기 기록을 지운다. 자동 전송은 없다.
- **입력 방어(2026-11-16)**: 2,000자(서버 `QQ_MAX_PROMPT`) 카운터 — 넘으면 빨갛게 표시하고 **보내지 않는다**(서버 거절 전에 막음). 높이는 `requestAnimationFrame` 으로 한 번만 계산(최대 180px) — 타자마다 reflow 하지 않는다. 보내는 동안 `[보내는 중...]` 으로 잠가 연타 중복을 막는다(`ORD_SEND_BUSY`). 승인·전송은 `ORD_EPOCH` 를 올려 **그 전에 시작한 목록 응답이 늦게 와도 덮어쓰지 않는다**.
- **실행 엔진 배지(2026-11-16)**: 결과가 `[agy] …` 처럼 엔진 이름으로 시작하면(워커가 붙임) 카드에 `⚡ agy`/`⚡ claude`/`⚡ 게이트웨이` 칩 — 폴백이 일어났는지 한눈에 보인다. `claude_prompt` 결과에만 붙인다.
- **목록 다시 그리기**: `ordSig`(id·status·result·error·duration)가 같으면 `renderOrderHead` 만 다시 쓰고 목록 HTML 은 건드리지 않는다(깜빡임·스크롤 튐 방지). 그릴 때 `ord-list` 의 `scrollTop` 을 지킨다.
- **탭 복귀(2026-11-16)**: `visibilitychange` → `ordOnShow()` — 카운트다운 재계산, 실행 중 오더가 있으면 1회 확인, 상태등 캐시가 5분을 넘겼을 때만 `queue_status` 1회.
- **AI 엔진 선택(2026-11-15)**: `자동 (정품 Claude→agy→FreeLLMAPI)` · `정품 Claude` · `제미나이 agy` · `FreeLLMAPI`. 값은 `payload.engine` 으로 가는데 **`auto` 는 싣지 않는다**(워커 기본값과 같은 뜻이라 오더 모양을 안 바꿈). 고른 엔진은 `localStorage.portal_ord_engine` 에 기억한다.
  - 엔진 선택이 노트북까지 닿으려면 **Code.gs 재배포가 필요**하다(`qqPayloadOf_` 가 engine 을 싣도록 고침). 예전 배포여도 화면은 그대로 동작하고 엔진값만 무시된다(오더는 auto 로 실행).
  - 서버는 `QQ_ENGINES = ['auto','claude','agy','freellmapi']` 로 검사하고 **모르는 이름은 `bad_request`**(조용히 auto 로 바꾸지 않음). `queue_list` 응답에 `engines` 를 함께 준다(화면은 고정 목록도 갖고 있어 예전 서버에서도 그려진다).
- **오더 도움말 패널(2026-11-15)**: `ord-help`(details) 안에 4갈래 — 🔄 저장소·최신화 / 📈 가계부·돈 / 🔎 조회·분석(파일 안 고침) / ✏️ 파일 수정(승인 필요).
  예시 버튼(`.ord-ex`)은 `ordExample(this)` 로 `data-fill` 글을 입력칸에 **채우기만** 하고(저절로 보내지 않음), `data-edit="1"` 이면 `파일 수정 허용` 체크까지 켠다. 예시는 사용자가 확인하고 보낸다.
- **`파일 수정 허용`(mode=edit)은 절대 바로 실행하지 않는다** → `WAITING_APPROVAL` 로 세우고 15분 안에 `[✅ 승인]`을 눌러야 `PENDING` 으로 내려간다(지나면 `EXPIRED`). 승인은 payload 해시에 묶여 있다(`approval_hash`).
- 목록은 최근 18건(최대 20). **payload 원문은 내보내지 않는다** — 주민·전화번호는 `[REDACTED]`, 내용은 한 줄 요약. 결과·오류도 같은 규칙으로 가린다.
- 서버가 예전 배포(오더함 모름)·`QUEUE_SHEET_ID` 미설정·시트 칸 부족·통신 실패면 **빨간 에러 대신 안내**(`ord-note`). `loadOrders()` 는 설정 전엔 요청을 보내지 않는다.
- 화면 값은 전부 `esc()` (오더 내용·결과·상태 모두 밖에서 온 글). 새로 그리는 함수는 `renderOrders`/`applyOrderList`/`renderOrderNotice` 하나씩만 거친다.
- 테스트: `portal_server` 9)절(규격·화이트리스트·해시·중복·만료·감사·잠금) · `portal_integration` R)절(그리기·승인/거절·Enter·XSS·안내 상태) · **S)절(자동 확인 조건·10분 상한·카운트다운·다시 실행·최근 글 5개·2,000자 방어·전송 잠금·늦은 응답 차단·탭 복귀)**. 가짜 스프레드시트는 `tests/lib/portal_fake_server.js` 가 읽기/쓰기(`appendRow`·`getRange().setValues`)까지 흉내 낸다.

## 🖥️ 작업 관제 (2026-11-17)

- 오더함 **위**에 `「🖥️ 작업 관제」` 카드(`#mon-card`) 하나. 기기 카드 4개(`#mon-cards`) + 통합 이력(`#mon-feed`) + `⟳`(`monRefresh(true)`).
  - **🤖 피클** = `status/agent.json`(공개, 개인정보 없음) 또는 서버 `agent_status`(드라이브 비공개 파일). 진행 중이면 작업·프로젝트·경과(1초), 30분 넘게 갱신이 없으면 **응답 없음**, 쉬는 중이면 마지막으로 끝낸 일과 결과.
  - **🏠 집 노트북** = `queue_status` 의 `heartbeat` + `queue_list` 의 `RUNNING` 오더. 실행 중이면 종류·작업 위치·요약, `⏱ 경과`(1초마다), 접수 시각. 하트비트가 10분 넘게 끊기면 **응답 없음**.
  - **💻 회사 PC** = 두 신호를 함께 본다. ① **PC 비트**(`agent_beat target=pc`, 드라이브 `포털_agent_pc.json`)가 있으면 그걸 먼저 — 비공개(Private) 저장소(`smartstore-hub`) 작업과 커밋 전 로컬 작업까지 보인다. 작업 중이면 프로젝트·작업명·경과(1초)·출처(`직접 표시`/`커밋 알림`), `stale_min`(직접 30분·커밋 120분)을 넘기면 **미확인**, idle 이면 마지막 작업. ② 비트가 없으면 지금처럼 브라우저가 GitHub(`api.github.com`)을 직접 읽은 **공개 저장소 4곳**(가계부·콘텐츠 허브·보험관리툴·포털)의 커밋·CI — 가장 최근 푸시가 10분 이내=방금 작업 / 1시간 이내=최근 작업 / 그 뒤=조용함.
  - **회사 PC 1줄 리포터(`tools/pc-beat.ps1`)**: 공개 파일이라 **키·서버 주소를 넣지 않는다**. 키는 그 PC 의 `%USERPROFILE%\.portal-beat.json`(또는 `PC_BEAT_URL`·`PC_BEAT_KEY` 환경변수)에만. `setup`(주소·키를 마스킹 입력으로 받아 저장 + `$PROFILE` 에 `pcbeat` 함수 + 자기 자신을 `%LOCALAPPDATA%\pc-beat.ps1` 로 복사) · `start "작업명" [프로젝트]` · `done` · `hook`(그 레포 `.git/hooks/post-commit` — 커밋 제목으로 `source=commit`·`stale 120`) · `test` · `status`. 보내기 전에 전화·메일·주민번호·32자 hex 를 `***` 로 가리고(`<PCBEAT_MASK>` 구간을 테스트가 같은 정규식으로 검증), 커밋 훅은 셸 `&` 로 **비동기**라 커밋을 붙잡지 않는다. 보내기 실패는 조용히 넘어간다(작업을 막지 않음).
  - **📋 오더 큐 · 자동화** = `queue_list` 가 주는 건수(PENDING·RUNNING·승인 대기·TIMEOUT_REVIEW·누적 완료/실패) + 오늘 끝낸 건수 + 자동 확인 상태.
- **정체 의심(`ordStale`)**: `RUNNING` 인데 `claimed_at`(없으면 `created_at`)부터 **20분**(워커 `CQ.STALE_MS`) 넘으면 노랑 `정체 의심`, **1시간** 넘으면 빨강 `멈춘 것 같아요`. 시트의 RUNNING 은 노트북이 죽어도 지워지지 않으므로(포털이 쓸 수 없음) 이 배지가 그 자리를 메운다. 오더 카드에도 `⚠ ⏱ …째 정체 의심` 배지.
- **생애주기(`ordSteps`)**: 오더마다 `① 접수 › ② 실행(차례/실행 중/승인 대기) › ③ 결과(끝냄/실패/실행 안 함)` 알약 3개. `PENDING`=② 실행 차례, `RUNNING`=② 실행 중, `DONE`=①②③ done, `FAILED`/`TIMEOUT_REVIEW`=③ 실패, `REJECTED`/`EXPIRED`=② 실행 안 함.
- **프로젝트 묶음(2026-11-17)**: `PROJ_LIST` = `smartstore`(🛒 묘한살림) · `content`(🎬 콘텐츠허브) · `gaegyebu`(📒 가계부) · `insurance`(🏦 보험관리툴) · `portal`(🖥️ 포털·연동) · `life`(📋 생활·행정). 오더는 `PROJ_OF_WS[workspace]`(토스 동기화는 가계부, 작업 위치가 없으면 생활·행정), 커밋은 `PROJ_OF_REPO`, 피클 작업은 `task.project`. `#mon-proj` 칩이 프로젝트별 `진행 N · 승인 N · 예정 N` 을 보여주고 누르면 `MON_PROJ` 필터(이력에만 적용).
- **통합 이력(`monEvents`)**: 오더 이벤트(끝난 오더는 `finished_at`, 그 외 `created_at`) · GitHub 커밋 · 피클 작업(`agentEvents`)을 시간 내림차순으로 섞어 최대 24건. 출처 배지 = `🤖 피클` / `🏠 노트북` / `💻 회사 PC` / `⚡ 에이전트`(`Merge pull request #N from …/agent/…` 커밋만). 갈래 버튼(`data-f` = all/pk/nb/pc/ag)은 `MON_FILTER`.
- **피클 상태 파일 규격(`status/agent.json`)**: `{version, updated_at, agent:{state:'working|idle', task, project, started_at, id}, tasks:[{id, project, title, state:'working|done|failed|planned', started_at, ended_at, result}]}`. **공개 저장소이므로 사람 이름·전화·계좌·금액 상세는 쓰지 않는다**(제목은 일 종류만). 피클이 일을 시작·끝낼 때 이 파일을 직접 덮어쓴다. 서버로도 읽으려면 드라이브 `김성래포털/포털_에이전트상태.json` 에 같은 모양으로 두면 `agent_status` 가 읽어 주고(`min`·`stale` 계산, 전화·주민 가림), 포털은 둘 중 `updated_at` 이 더 최신인 쪽을 쓴다.
- **GitHub 호출 예절**: 커밋 5분(`GH_TTL`)·CI 15분(`GH_RUN_TTL`) 캐시를 `localStorage.portal_gh_cache` 에. 로그인 없이 **시간당 60회**뿐이라 `⟳` 없이는 캐시가 신선하면 부르지 않는다. 403/429 면 `limited` → "호출 한도" 안내 + 저장된 기록 유지. **`ghCanFetch()` = https 페이지에서만**(http·파일로 열면 브라우저가 섞인 요청을 막음) — 테스트 가짜 화면에는 `location` 이 없어 자동 호출이 일어나지 않는다. 피클 상태 파일은 `agentCanFetch()`(http/https) 로 같은 방식으로 막는다.
- **그리기 규칙**: `monRender()` 는 `ordSig`+오더시각+건수+GitHub/상태등/피클 시각+필터 서명이 같으면 아무것도 안 건드린다. 경과 시간은 `ordTick` 이 `.ord-elapsed[data-since]` 글자만 1초마다 바꾼다(`ordTickStart` 는 `.ord-cd` 또는 `.ord-elapsed` 가 있을 때만 타이머).
- **서버 확장(재배포 필요)**: `Code.gs` `qqItem_` 가 `claimed_at`·`claimed_by` 를, `heartbeatStatus_` 가 `current`·`current_type`·`daemon`·`processed`·`polls`·`version` 을, `agentStatus()` 가 드라이브 `포털_에이전트상태.json`(읽기 전용·가림)을 준다. 예전 배포여도 화면은 그대로 동작하고(접수 시각 기준·하트비트·피클 서버 기록 없음), 재배포하면 경과 시간이 정확해지고 오더 목록에 없어도 하트비트만으로 "지금 작업"이 보인다.
- 테스트: `portal_integration` **T)절**(정체 의심 임계값·생애주기·카드 4개·CI 표기·통합 이력 정렬/필터/이스케이프·다시 그리기 서명·GitHub 미호출) · **U)절**(프로젝트 묶음·칩·필터, 피클 카드 3상태, 피클 이력) · `portal_server` 8)절(하트비트 현재 작업) · ⑬-2(claimed 필드) · 10)절(agent_status 가림/상한/예외).

## 서버 (Code.gs)

- POST 전용, 모든 요청에 비밀 키. `doGet` 은 안내 문구만.
- 동작: `ping`, `getTaskLists`, `getTasks`, `addTask`, `completeTask`, `deleteTask`, `getCalendarEvents`(ym), `createEvent`, `deleteEvent`, `cal_list` / `cal_create` / `cal_update`(🗓️ 비서·큐 전담 일정 API — 2026-11-26, **삭제는 없다**), `loadMemos`, `saveMemos`(baseRev, force), `queue_status`(읽기 전용), `agent_status`(읽기 전용 — 드라이브 피클 상태 + `direct`·`pc` 비트 + `beat_targets`), `queue_list` / `queue_enqueue` / `queue_decide` / `queue_claim` / `queue_done`(오더함), `agent_beat`(기기 상태 비트 — `target:'direct'|'pc'`, `stale_min` 5~240, `source`), `usage_get` / `usage_set` / `usage_report`(📊 비서 사용량), `agents_get` / `agent_save`(👥 참여 비서 명부·담당), `webhook_set`(🔔 외부 비서 웹훅 주소 — ScriptProperties). GET 읽기는 `ping`·`queue_status`·`queue_list`·`queue_head`·`queue_brief`·`queue_inbox`·`usage_get`·`agents_get`·`webhook_last`·`auth_link` 열 개(`GET_ACTIONS`).
- **일정 API(2026-11-26)**: 큐가 직접 부른다. 날짜는 'YYYY-MM-DD'(종일)·'YYYY-MM-DDTHH:mm'·공백 형식, 시간대 생략 시 `Asia/Seoul`. **종일 `end` 는 마지막 날(포함)** — `cal_list` 결과를 `cal_update` 에 그대로 넣어도 하루 밀리지 않는다. `cal_create` 는 같은 제목·같은 시작이면 `duplicate:true` 로 기존 id 를 돌려주고(`allowDuplicate:true` 로 해제), `cal_update` 는 안 보낸 값을 그대로 둔다. 기간 상한 62일. **삭제 액션은 없다** — 지우는 일은 화면(`deleteEvent`)에서만.
- **`agent_beat`(2026-11-18)**: `target` 이 없으면 `direct` — 예전 `$PROFILE free` 함수와 그대로 호환된다. 파일은 `포털_agent_직접.json` / `포털_agent_pc.json` 두 장(같은 스키마·이력 8건·`qqMask_` 가림). `agent_status` 는 둘을 `direct`·`pc` 블록으로 내려주고 `beat_targets` 로 **이 배포가 pc 를 아는지** 알려준다(화면이 재배포 안내를 고를 때 씀).
- **오더함은 `work/hub-agent/gas/CommandQueue.gs` 와 100% 호환**이어야 한다: 같은 22칸(`CQ_COLS`), 같은 상태값(`PENDING`·`WAITING_APPROVAL`·`RUNNING`·`DONE`·`FAILED`·`REJECTED`·`EXPIRED`·`TIMEOUT_REVIEW`), 같은 `Audit_Log` 11칸, 같은 payload 해시(canonical JSON 의 SHA-256 — 워커 `lib/approval.js` 와 같은 값). 바꿀 때는 양쪽을 같이 고친다.
- 오더함 화이트리스트는 `git_pull`·`toss_sync`·`claude_prompt` 셋뿐(`QQ_TYPES`). `git_push`·`smartstore_api_relay` 는 포털에서 접수하지 않는다. 작업 위치는 `QUEUE_WORKSPACES`(선택, 없으면 `gaegyebu,content-hub,insurance-manager,smartstore-hub`).
- `claude_prompt` 의 payload 는 `{prompt, mode}` 이고, 엔진을 골랐으면 `engine` 이 더 붙는다(`{prompt, mode, engine}`). **payload 해시는 engine 까지 묶는다** — 승인 뒤 엔진이 바뀌면 노트북이 거절한다.
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

## 홈 화면 앱 아이콘 (PWA, 2026-11-15)

- 폰 홈 화면에 "김성래 포털"(라벨 "성래포털") 앱처럼 추가된다. `manifest.webmanifest`(뿌리) — `start_url`·`scope` 는 `./`, `display: standalone`, `background_color #F0F4FF`·`theme_color #FFFFFF`(헤더가 흰색이라 상태바도 흰색).
- 아이콘 `icons/icon-192.png`·`icons/icon-512.png`: 남색 그라데이션 + 골드 `P` 모노그램 + 얇은 골드 링. 꽉 찬 배경 + 가운데 글자라 `purpose: any maskable` — 안드로이드가 동그라미·스퀘어클로 잘라도 안전(링 r=374/1024 < 안전 반지름 410). `index.html` head 에 manifest·icon·apple-touch-icon·theme-color·mobile-web-app-capable.
- **Service Worker 는 일부러 넣지 않는다** — 캐시가 꼬여 예전 화면이 남는 걸 막으려고. 나중에 오프라인 캐시가 필요하면 버전 붙인 SW 를 따로 설계한다(지금은 금지). `tests/pwa.test.js` 가 이 금지와 매니페스트·아이콘 실제 크기를 지킨다.

## 테스트

- `tests/lib/portal_fake_server.js`: 가짜 CalendarApp·Tasks·DriveApp 위에서 실제 Code.gs 실행.
- `portal_integration.test.js` 는 포털 스크립트 전체를 가짜 브라우저에서 돌린다. 시간대 Asia/Seoul 고정.
- 테스트 종류: `portal_server`, `portal_merge`(메모 병합 규칙), `portal_integration`, `prediag`, `memo-safety`, `pwa`(홈 화면 아이콘). `queue_status`·상태등은 `portal_server` 8)절과 `portal_integration` Q)절이, 오더함은 `portal_server` 9)절과 `portal_integration` R)절이 검증한다(가짜 시트·가짜 heartbeat·가짜 스냅샷).
- `tests/lib/portal_fake_server.js` 의 가짜 스프레드시트는 `getRange().getValues/setValues`·`appendRow`·`insertSheet` 까지 흉내 낸다 — 오더함 쓰기를 실제 Code.gs 로 돌려 시트 배열을 직접 확인한다.


## 에이전트 동시 작업 규칙 (피클·집 노트북·회사 PC 공통, 2026-11-19)

- **시작**: `git pull --ff-only` → 같은 기기에서 `agent-lock lock <레포> "작업명"` → `pcbeat start "작업명" <프로젝트>`. ff 불가·잠금 충돌이면 **멈추고 보고**한다(임의 merge·force 금지).
- **같은 레포를 병렬로** 해야 하면 `agent-lock wt <레포> <작업이름>`(로컬 워크트리·브랜치 `agent/<기기>/<작업>`), 끝나면 테스트 후 `agent-lock wtdone`.
- **끝**: 테스트 → 한 가지씩 커밋 → 즉시 `git push` → `agent-lock unlock <레포>` → `pcbeat done`.
- **금지**: `push --force`·`reset --hard`·충돌 파일 통째 덮어쓰기·남의 `agent/…`·`auto/…` 브랜치 수정·`status/agent.json` 직접 수정(피클 전용). 키·주소·고객 정보는 어디에도 넣지 않는다.
- 전체 규칙·한계·설치: `s2ongrae.github.io` 의 `docs/AGENT_COORDINATION.md`, 도구 `tools/agent-lock.ps1`.

### 🌿 어사이드(aside) 버튼 (2026-11-25)

집 노트북의 로컬 자동화(`aside` — 무신사·카카오 체험단, 공공퀴즈, 네이버·알리 출첵)를 포털에서 원탭으로 부른다.

- **`apps-script/Code.gs` 는 건드리지 않는다(웹훅 v36 유지).** 포털 서버는 `claude_prompt` 만 받으므로,
  새 오더 타입 대신 **회의실 한 줄 명령**을 기존 봉투에 실어 보낸다 — `type:'claude_prompt'` +
  `payload:{kind:'chat', prompt:'🌿어사이드 <작업>'}` (`quickAside(job)`). `target` 은 서버가 notebook 기본으로 둔다.
- 화면: ① `빠른 오더`(`ORD_PRESETS`)에 `🌿 어사이드`(입력칸을 `🌿어사이드 상태` 로 채움 — 다른 칩과 같은 규칙)
  ② `뭘 시킬 수 있나` 의 `🌿 어사이드 — 집 노트북 자동화` 칸에 버튼 6개(상태·무신사·카카오·공공퀴즈·네이버·알리) — **누르면 바로 접수**(원탭).
- 상태 확인은 아무것도 실행하지 않아 확인창이 없고, 실행 작업은 `confirm` 한 번 뒤 보낸다(외부 사이트에 실제로 반영됨).
- **작업 낱말(`ASIDE_JOBS[].word`)은 노트북 `hub-agent/notebook-agent/lib/aside.js` 의 표와 같아야 한다**(`🌿어사이드 무신사` → `musinsa`).
  바꾸면 양쪽을 같이 고치고 `tests/portal_integration` Y)절도 같이 고친다.
- 결과는 노트북이 같은 회의실로 자동 보고한다(`kind:'chat'`, `target:'portal'` 한 줄 — 서버가 전달 완료로 닫는다).
- `ORD_TYPE_LABEL/ICON` 에 `aside_run`(🌿 어사이드)을 넣어 큐에 `aside_run` 오더가 보여도 읽힌다.
- 작업 위치(`workspace`)는 서버 양식상 필요한 칸일 뿐, 어사이드 실행에는 쓰이지 않는다(현재 고른 위치가 그대로 실린다).

## ECC 스킬 (2026-11-19)

- `affaan-m/ECC` v2.2.3에서 포털에 맞는 2개만 골라 `.claude/skills/ecc-*/`에 넣었다 — `ecc-security-review`(공개 저장소·GAS 키·`esc()` 누락·민감정보 노출) · `ecc-make-interfaces-feel-better`(폰 헤더·칩·달력의 여백·터치·모션).
- 본문은 영어 원문 그대로, 앞머리에 이 레포 기준 한국어 메모. 고른 이유·갱신은 `.claude/skills/ECC.md`. **부딪히면 이 CLAUDE.md의 폰 화면·메모 동기화 규칙이 우선한다.**

## 전용 앱 — AI 비서 회의실 (`room/`, 2026-11-25)

- 포털 회의실을 **폰 홈 화면 앱**으로 따로 띄우는 화면이다: `https://s2ongrae.github.io/room/`. 포털의 다른 메뉴(달력·주식·보험)는 없다 — 방 제목·편대/사용량 서랍·타임라인·입력바뿐.
- **회의실 규칙은 세 곳이 같아야 한다(2026-11-26 개정)**: 포털 회의실(`index.html`) · 서버(`apps-script/Code.gs`) · 전용 앱(`room/`). 예전에는 "room/ 안에서만 고친다"였지만, 완료 보고·스레드·히스토리 필터처럼 **규칙이 걸린 기능**은 세 곳을 같이 고친다 — 한쪽만 고치면 두 화면이 다른 말을 한다(`tests/room.test.js` N-2)절과 `portal_integration` AF·AG)절이 잡는다. 전용 앱만의 화면·스타일(매니페스트·SW·아이콘 등)은 지금처럼 `room/` 안에서 끝낸다.
- 회의실 상단 `#fbar`(검색 `#srch` + `#fchips` + `#fcnt`)로 비서·상태(보고누락 포함)·키워드를 한 번에 거른다. 말풍선 `data-rep`(↩ 답장 → `#rep` 배너, `payload.reply_to`) · `data-th`(💬 스레드 → `#thread` 시트) · `data-go`(원문으로 이동). 인라인 `onclick` 은 쓰지 않는다(테스트).
- 같은 큐·같은 키를 쓴다: `queue_list`(limit ≤ 20) · `usage_get` · `queue_status` · 전송은 `queue_enqueue`(`type:'claude_prompt'`, `payload.kind:'chat'`, `payload.target`). 인증은 포털과 같은 localStorage `portal_server_url`·`portal_server_key` 라서 포털에 넣은 기기면 자동 인식된다. **주소·키는 코드에 넣지 않는다.**
- 편대 9명(피원·피투·노트북·큐·큐투·부이·뷔투·키링·키투)과 `@전체` 멘션 칩은 `app.js` 의 `ROOM_AGENTS`·`ROOM_CHIPS` 한 곳에서만 고친다.
- 앱 안에서 승인·오더 실행은 하지 않는다(대화 전용). 승인은 포털 회의실에서.
- `sw.js` 는 **네트워크 우선**이라 예전 화면이 남지 않는다(캐시는 오프라인 껍데기용, `room-` 접두사만 지운다).
- 테스트: `node tests/room.test.js` (매니페스트·아이콘·SW·문법·`<ROOM_CORE>` 순수 로직 150건). `npm test` 에 포함돼 있다.
