# `.claude/skills/ecc-*` — ECC에서 골라 온 스킬 (2026-11-19)

원본: `affaan-m/ECC` **v2.2.3** — `skills/` 327종 · `rules/` 122파일 · `agents/` 72종 · `commands/` 98종 (커밋 `3f14a10`).
공개 저장소 포털에 맞는 **2개**만 골랐다. 본문은 영어 원문 그대로, 앞머리에 이 레포 기준 한국어 메모.
**규칙이 부딪히면 이 레포 `CLAUDE.md`가 우선이다.**

| 스킬 | 원본 | 이 레포에서 쓰는 자리 | 주의 |
|---|---|---|---|
| `ecc-security-review` | `security-review` | 서버 키·메모 데이터·오더함 payload를 다루는 코드, `esc()` 누락 점검 | 키는 localStorage에만. 오더 payload 원문은 서버가 안 돌려줌 |
| `ecc-make-interfaces-feel-better` | `make-interfaces-feel-better` | 폰 헤더·달력·칩·버튼의 여백·터치 크기·상태 표현 다듬기 | 폰 헤더 한 줄·349px 규칙·34/36px 값이 44px 권장보다 우선 |

## 갱신·제거

- **갱신**: 원본 `skills/<이름>/SKILL.md`와 각 폴더 원문 본문(구분선 아래)을 비교. 원본 SHA가 달라지면 `upstream_commit`도 같이.
- **제거**: `ecc-*` 폴더 삭제로 끝. `npm test`(정적 검사 + 5종)는 이 폴더를 읽지 않는다.
