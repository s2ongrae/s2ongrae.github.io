# 💬 AI 비서 회의실 (`room/`)

폰 홈 화면에 설치해 쓰는 **AI 단톡방 전용 앱** — `https://s2ongrae.github.io/room/`

## 무엇을 하나

- 포털 `#order-card`(비서 통합 회의실)와 **같은 큐**를 카톡처럼 보여 줍니다: `queue_list` · `usage_get` · `queue_status`
- 보내기는 `queue_enqueue` (`type: claude_prompt`, `payload.kind: 'chat'`, `payload.target: @멘션`)
- 머리말의 `👥 9명 · 🟢 n` 을 누르면 **편대 서랍**: 9명 역할 한 줄 + 잔여 % + 최근 활동
- 앱에서 승인·오더 실행은 하지 않습니다(대화 전용) — 승인은 포털 회의실에서.

## 파일

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 뼈대(머리말·타임라인·입력바·서랍·설정 시트) |
| `app.css` | 카톡형 스타일 · 다크모드 · 폰/PC 반응형 |
| `app.js` | 서버 호출·렌더링. `<ROOM_CORE>` 구간은 순수 로직(테스트가 검증) |
| `manifest.webmanifest` | `start_url`·`scope` `/room/`, `display: standalone` |
| `sw.js` | 홈 화면 설치 요건 + 오프라인 껍데기(네트워크 우선) |
| `icons/` | 192·512 아이콘(금색 말풍선 + 안테나) — 포털 `P` 와 구별 |

## 서버 연결

포털과 **같은 localStorage 키**를 씁니다: `portal_server_url`, `portal_server_key`.
같은 주소(`s2ongrae.github.io`)라서 포털에 한 번 넣었으면 자동 인식됩니다.
안 되어 있으면 앱이 설정 창을 띄웁니다(주소 형식 검사 + `ping` 테스트 후 저장).

## 홈 화면에 추가

- **안드로이드(크롬)**: 주소를 열고 ⋮ → **앱 설치** / **홈 화면에 추가**
- **아이폰(사파리)**: 공유 → **홈 화면에 추가**
- 설치하면 주소창 없이 `💬 AI 비서 회의실` 로 열립니다.

## 손보는 법

- 편대·멘션: `app.js` 의 `ROOM_AGENTS` · `ROOM_CHIPS`
- 색·여백: `app.css` 의 `:root` 변수
- 테스트: `node tests/room.test.js` (매니페스트·아이콘·SW·문법·핵심 로직)
