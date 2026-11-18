const mk = require('./lib/portal_fake_server.js');
const nodeCrypto = require('crypto');
let pass=0, fail=0; const ok=(c,m)=>{ if(c) pass++; else { fail++; console.log('  ❌',m); } };
const S = mk(), K = S.KEY, post = S.post;
const memo = (id,x={})=>Object.assign({id,title:'제목'+id,body:'내용'+id,color:'mc-blue',pinned:false,updatedAt:'2026-10-01T00:00:00Z'},x);

console.log('1) 접근 통제');
let r = S.doGet(); ok(r.ok===false && r.error==='POST로만 사용할 수 있어요.' && Object.keys(r).length===2, 'doGet은 안내 문구만(캘린더·메모 안 줌)');
for(const a of ['getTaskLists','getTasks','addTask','completeTask','deleteTask','getCalendarEvents','createEvent','deleteEvent','loadMemos','saveMemos','ping','queue_status','queue_list','queue_enqueue','queue_decide','agent_beat']){
  r = post({action:a}); ok(r.error==='unauthorized', `키 없이 ${a} 거절`);
  r = post({action:a, key:'x'.repeat(64)}); ok(r.error==='unauthorized', `틀린 키로 ${a} 거절`);
}
ok(S.sb.__sleeps>=20, '틀릴 때 지연 적용');
ok(post('not json').ok===false && post({key:K}).ok===false && post({action:5,key:K}).ok===false, '깨진 요청 거절');
ok(post({action:'hack',key:K}).ok===false, '알 수 없는 action 거절');
S.props.SECRET_KEY='short'; ok(post({action:'ping',key:'short'}).error==='unauthorized','32자 미만 키 거절'); S.props.SECRET_KEY=K;
ok(post({action:'ping',key:K}).ok===true, '올바른 키 ping 성공');
const oldKey = K; delete S.props.SECRET_KEY; ok(post({action:'ping',key:oldKey}).error==='unauthorized','키 미설정이면 전부 거절'); S.props.SECRET_KEY=K;

console.log('2) 캘린더');
r = post({action:'createEvent',key:K,date:'2026-10-20',title:'종일 일정'}); ok(r.ok&&r.eventId, '종일 일정 생성');
r = post({action:'createEvent',key:K,date:'2026-10-20',title:'회의',startTime:'14:00',endTime:'15:30',desc:'설명'}); ok(r.ok, '시간 일정 생성');
r = post({action:'createEvent',key:K,date:'2026-10-21',title:'종료없음',startTime:'09:00'}); ok(r.ok, '종료 시간 없으면 1시간');
const e3 = S.events.find(e=>e.title==='종료없음'); ok(e3.end-e3.start===3600000, '종료 없는 일정은 정확히 60분');
r = post({action:'createEvent',key:K,date:'2026-10-21',title:'역순',startTime:'10:00',endTime:'09:00'}); ok(r.ok && S.events.find(e=>e.title==='역순').end-S.events.find(e=>e.title==='역순').start===3600000, '종료가 시작보다 빠르면 1시간으로 보정');
r = post({action:'createEvent',key:K,date:'2026-02-30',title:'x'}); ok(r.ok===false, '없는 날짜 거절');
r = post({action:'createEvent',key:K,date:'20261020',title:'x'}); ok(r.ok===false, '날짜 형식 거절');
r = post({action:'createEvent',key:K,date:'2026-10-20',title:'   '}); ok(r.ok===false, '빈 제목 거절');
r = post({action:'createEvent',key:K,date:'2026-10-20',title:'x'.repeat(2000)}); ok(r.ok && S.events.some(e=>e.title.length===500), '긴 제목은 500자로 자름');
r = post({action:'getCalendarEvents',key:K,ym:'2026-10'}); ok(r.ok && r.events['2026-10-20'].length>=2, '월 조회');
ok(r.events['2026-10-20'].some(e=>e.time==='14:00') && r.events['2026-10-20'].some(e=>e.allDay), '시간·종일 구분');
for(const bad of ['2026-13','26-10','abc',null,'2026-10-01','2026-1']){ ok(post({action:'getCalendarEvents',key:K,ym:bad}).ok===false, `월 형식 거절: ${bad}`); }
const evId = S.events[0].id;
r = post({action:'deleteEvent',key:K,eventId:evId}); ok(r.ok && !S.events.some(e=>e.id===evId), '일정 삭제');
ok(post({action:'deleteEvent',key:K,eventId:''}).ok===false && post({action:'deleteEvent',key:K,eventId:'x'.repeat(400)}).ok===false, '이상한 일정 ID 거절');

console.log('3) Tasks');
r = post({action:'getTaskLists',key:K}); ok(r.ok && r.lists.length===2, '목록 조회');
r = post({action:'addTask',key:K,listId:'@default',title:'할 일 1',notes:'메모'}); ok(r.ok&&r.taskId, '추가');
ok(post({action:'addTask',key:K,title:'   '}).ok===false, '빈 제목 거절');
r = post({action:'getTasks',key:K,listId:'@default'}); ok(r.ok && r.tasks.length===1 && r.tasks[0].done===false, '조회');
const tid = r.tasks[0].id;
r = post({action:'completeTask',key:K,listId:'@default',taskId:tid}); ok(r.ok&&r.done===true, '완료 토글');
r = post({action:'completeTask',key:K,listId:'@default',taskId:tid}); ok(r.ok&&r.done===false, '다시 토글');
ok(post({action:'deleteTask',key:K,listId:'@default',taskId:''}).ok===false, '빈 할 일 ID 거절');
ok(post({action:'getTasks',key:K,listId:'x'.repeat(300)}).ok===false, '너무 긴 목록 ID 거절');
r = post({action:'deleteTask',key:K,listId:'@default',taskId:tid}); ok(r.ok && S.taskStore['@default'].length===0, '삭제');
ok(post({action:'addTask',key:K,title:'t'.repeat(3000)}).ok && S.taskStore['@default'][0].title.length===1024, '긴 제목은 1024자로 자름');

console.log('4) 메모 — 저장·개정번호·충돌');
r = post({action:'loadMemos',key:K}); ok(r.ok && r.rev===0 && r.memos.length===0, '새 서버는 빈 메모 rev 0');
r = post({action:'saveMemos',key:K,baseRev:0,memos:[memo('a'),memo('b'),memo('c'),memo('d'),memo('e')]}); ok(r.ok&&r.rev===1, '첫 저장 rev 1');
r = post({action:'saveMemos',key:K,baseRev:0,memos:[memo('x')]}); ok(r.conflict===true && r.rev===1 && r.memos.length===5, '옛 rev로 저장하면 충돌(덮어쓰지 않음)');
r = post({action:'loadMemos',key:K}); ok(r.memos.length===5 && r.memos[0].id==='a', '충돌 시 서버 메모 그대로');
r = post({action:'saveMemos',key:K,baseRev:1,memos:[memo('a',{title:'수정'}),memo('b'),memo('c'),memo('d'),memo('e'),memo('f')],tombstones:{z:'2026-10-02T00:00:00Z'}}); ok(r.ok&&r.rev===2, '맞는 rev로 저장');
r = post({action:'loadMemos',key:K}); ok(r.memos[0].title==='수정' && r.tombstones.z, '저장 내용·삭제 기록 보관');
ok(post({action:'saveMemos',key:K,baseRev:2,memos:'x'}).ok===false, '모양이 이상한 메모 목록 거절');
ok(post({action:'saveMemos',key:K,baseRev:2,memos:[{title:'id없음'}]}).ok===false, 'id 없는 메모 거절');
ok(post({action:'saveMemos',key:K,baseRev:2,memos:[memo('a'),memo('a')]}).ok===false, '중복 id 거절');
S.setLock(true); r = post({action:'saveMemos',key:K,baseRev:2,memos:[memo('a')]}); ok(r.ok===false && /진행 중/.test(r.error), '동시 저장(잠금) 중이면 거절'); S.setLock(false);
r = post({action:'saveMemos',key:K,baseRev:2,memos:[memo('q',{color:'<script>',title:'<b>x</b>'.repeat(100),pinned:'yes'}),memo('b'),memo('c'),memo('d'),memo('e'),memo('f')]});
ok(r.ok, '색상·고정 값이 이상해도 저장은 되되'); r = post({action:'loadMemos',key:K});
ok(r.memos[0].color==='mc-yellow' && r.memos[0].pinned===false && r.memos[0].title.length===200, '색상은 허용 목록으로, 고정은 true만, 제목은 200자로 정리됨');

console.log('5) 메모 — 줄어듦 방지·백업');
r = post({action:'loadMemos',key:K}); const rev = r.rev;
ok(post({action:'saveMemos',key:K,baseRev:rev,memos:[memo('only')]}).error==='shrink', '메모가 절반 아래로 줄면 중단');
ok(post({action:'loadMemos',key:K}).memos.length===6, '중단된 저장은 서버 메모를 건드리지 않음');
r = post({action:'saveMemos',key:K,baseRev:rev,force:true,memos:[memo('only')]}); ok(r.ok, 'force 저장은 허용(복원용)');
const bdir = S.ROOT.folders[0].folders.find(f=>f.name==='백업'); const names=bdir.files.map(f=>f.name);
ok(names.includes('포털_메모_2026-10-13.json'), '하루 1회 백업 생성');
ok(names.filter(n=>/_2026-10-13\.json$/.test(n)).length===1, '같은 날 중복 백업 안 함');
ok(names.some(n=>/복원전/.test(n)), 'force 직전엔 별도 백업');
ok(JSON.parse(bdir.files.find(f=>f.name==='포털_메모_2026-10-13.json').content).memos.length===0, '백업은 저장 "직전" 상태');
S.tick(20*86400e3); r = post({action:'loadMemos',key:K}); post({action:'saveMemos',key:K,baseRev:r.rev,memos:[memo('n1'),memo('n2')]});
ok(!bdir.files.some(f=>!f.trashed&&/2026-10-13/.test(f.name)), '14일 지난 백업은 휴지통으로');

console.log('6) 손상 파일·옛 형식');
const mf = S.memoFile(); const keep = mf.content;
mf.content = '{"memos":[{"title":"깨짐'+'x'.repeat(40);
ok(post({action:'saveMemos',key:K,baseRev:0,memos:[memo('z')]}).ok===false, '손상된 파일은 빈 데이터로 보고 덮어쓰지 않음');
ok(post({action:'loadMemos',key:K}).ok===false, '손상 파일 읽기도 안전하게 실패');
mf.content = JSON.stringify({memos:[{title:'옛메모',body:'id없음',color:'mc-pink',updatedAt:'2026-01-01T00:00:00Z'}],savedAt:'x',version:2});
r = post({action:'loadMemos',key:K}); ok(r.ok && r.rev===0 && r.memos.length===1 && r.memos[0].title==='옛메모', '옛 형식(id·rev 없음) 메모도 그대로 읽힘');
r = post({action:'saveMemos',key:K,baseRev:0,memos:[memo('m1'),{...memo('m2'),title:'옛메모'}]}); ok(r.ok&&r.rev===1, '옛 파일 위에 첫 저장(rev 0→1)');
mf.content = keep;

console.log('7) 키 생성/교체');
delete S.props.SECRET_KEY; S.run('createSecretKey()'); ok(S.props.SECRET_KEY&&S.props.SECRET_KEY.length===64, 'createSecretKey 64자');
const k1=S.props.SECRET_KEY; S.run('createSecretKey()'); ok(S.props.SECRET_KEY===k1, '이미 있으면 덮어쓰지 않음');
S.run('rotateSecretKey()'); ok(S.props.SECRET_KEY!==k1, 'rotateSecretKey 교체'); ok(post({action:'ping',key:k1}).error==='unauthorized', '교체 후 옛 키 거절');

console.log('8) 관제 상태등 (queue_status) — 읽기 전용');
{
  const K2 = S.props.SECRET_KEY;                       // 7)에서 키를 교체했어요
  let q = post({action:'queue_status', key:K2});
  ok(q.ok===true && q.connected===false && q.queue.state==='unknown' && q.heartbeat.state==='unknown' && q.toss.state==='unknown', '속성이 없으면 예외 없이 "미연결"');
  ok(q.config && q.config.queue===false, '연결 여부를 따로 알려 줌');

  const nowMs = S.run('Date.now()'), kst = ms => new Date(ms + 9*3600e3).toISOString().slice(0,10);
  const iso = m => new Date(nowMs - m*60000).toISOString();
  const TODAY = kst(nowMs), dayAgo = n => kst(nowMs - n*86400000);

  S.props.QUEUE_SHEET_ID = 'SHEETidForTest0001';        // 가짜 ID (공개 저장소에 넣지 않음)
  q = post({action:'queue_status', key:K2});
  ok(q.ok===true && q.config.queue===true && q.queue.state==='unknown', '시트를 열 수 없어도 예외 없이 unknown');
  ok(!JSON.stringify(q).includes('SHEETidForTest'), '응답에 시트 ID가 나가지 않음');

  const head = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by','finished_at'];
  const row = (id, created, status, claimed) => [id, created, 'phone', 'git_pull', 'gaegyebu', '{}', status, 0, claimed||'', '', ''];
  const setRows = rows => S.addSheet('SHEETidForTest0001', {'Command_Queue':[head].concat(rows)});

  setRows([row('c1', iso(30), 'DONE', iso(2)), row('c2', iso(8), 'PENDING'), row('c3', iso(12), 'WAITING_APPROVAL')]);
  q = post({action:'queue_status', key:K2});
  ok(q.queue.pending===1 && q.queue.waiting===1 && q.queue.timeout===0, 'PENDING·WAITING_APPROVAL 건수');
  ok(q.queue.state==='warn', '승인 대기 1건이면 노랑');
  ok(q.queue.oldest_min>=7 && q.queue.oldest_min<=9, '가장 오래된 PENDING 경과 시간');
  ok(q.heartbeat.state==='ok' && q.heartbeat.source==='sheet' && q.heartbeat.min===2 && q.heartbeat.approx===true, '하트비트 파일이 없으면 시트 마지막 활동(2분 전)으로 대략 표시');

  setRows([row('c1', iso(30), 'DONE', iso(2)), row('c2', iso(8), 'PENDING'), row('c3', iso(12), 'PENDING')]);
  ok(post({action:'queue_status', key:K2}).queue.state==='warn', 'PENDING 2건이면 노랑');
  setRows([row('c1', iso(30), 'DONE', iso(2)), row('c2', iso(20), 'PENDING')]);
  ok(post({action:'queue_status', key:K2}).queue.state==='bad', 'PENDING 이 15분 넘게 쌓이면 빨강');
  setRows([row('c1', iso(30), 'DONE', iso(2)), row('c2', iso(3), 'TIMEOUT_REVIEW')]);
  q = post({action:'queue_status', key:K2});
  ok(q.queue.state==='bad' && q.queue.timeout===1, 'TIMEOUT_REVIEW 1건이면 빨강');
  setRows([row('c1', iso(30), 'DONE', iso(2)), row('c2', iso(40), 'FAILED'), row('c3', iso(50), 'REJECTED')]);
  q = post({action:'queue_status', key:K2});
  ok(q.queue.state==='ok' && q.queue.pending===0 && q.queue.waiting===0, '밀린 것이 없으면 초록');

  const hbf = S.ROOT.createFile('heartbeat.json', JSON.stringify({updated_at:iso(2), state:'running'}));
  S.props.HEARTBEAT_FILE_ID = hbf.id;
  q = post({action:'queue_status', key:K2});
  ok(q.config.heartbeat===true && q.heartbeat.source==='drive' && q.heartbeat.state==='ok', '하트비트 파일(2분 전) → 초록');
  // 2026-11-17: 노트북이 "지금 무엇을 돌리는지"도 하트비트로 같이 보여줍니다(없으면 그 칸만 빠짐)
  hbf.content = JSON.stringify({updated_at:iso(1), state:'running', processed: 12, polls: 340, version:'1.2.0',
    started_at:'2026-10-12T20:00:00+09:00', current:'Q-20261013-120000-abcd', current_type:'claude_prompt'});
  q = post({action:'queue_status', key:K2});
  ok(q.heartbeat.current==='Q-20261013-120000-abcd' && q.heartbeat.current_type==='claude_prompt', '하트비트의 현재 작업을 그대로 넘긴다');
  ok(q.heartbeat.processed===12 && q.heartbeat.polls===340 && q.heartbeat.daemon==='running' && q.heartbeat.version==='1.2.0', '처리 건수·데몬 상태·버전도 같이');
  ok(q.heartbeat.state==='ok' && q.heartbeat.min===1, '지금 작업이 있어도 신호등은 그대로');
  hbf.content = JSON.stringify({updated_at:iso(1), current:{id:'Q-obj'}, processed:'많음'});
  q = post({action:'queue_status', key:K2});
  ok(q.heartbeat.current==='Q-obj' && q.heartbeat.processed===0, '예전 형식(객체·이상한 값)도 예외 없이 처리');
  hbf.content = JSON.stringify({updated_at:iso(30)});
  q = post({action:'queue_status', key:K2});
  ok(q.heartbeat.current==='' && q.heartbeat.state==='warn', '하트비트에 현재 작업 칸이 없으면 빈 칸(경고 없음, 신호등만 노랑)');
  hbf.content = JSON.stringify({updated_at:iso(30)});
  ok(post({action:'queue_status', key:K2}).heartbeat.state==='warn', '30분 전(1시간 안쪽) → 노랑');
  hbf.content = JSON.stringify({updated_at:iso(200)});
  ok(post({action:'queue_status', key:K2}).heartbeat.state==='bad', '200분 전(1시간 초과) → 빨강');
  hbf.content = 'not json';
  ok(post({action:'queue_status', key:K2}).heartbeat.state==='unknown', '깨진 파일은 예외 없이 unknown');
  ok(!JSON.stringify(post({action:'queue_status', key:K2})).includes(hbf.id), '응답에 파일 ID가 나가지 않음');
  delete S.props.HEARTBEAT_FILE_ID;

  const gf = S.ROOT.createFolder('가계부');
  const sf = gf.createFile('가계부_주식스냅샷.json', JSON.stringify({latest:{date:TODAY, at:iso(30)}, history:[]}));
  q = post({action:'queue_status', key:K2});
  ok(q.toss.state==='ok' && q.toss.date===TODAY && q.toss.days===0 && q.config.toss===true, '오늘 스냅샷 → 초록');
  sf.content = JSON.stringify({latest:{date:dayAgo(1)}});
  ok(post({action:'queue_status', key:K2}).toss.state==='ok', '어제(주말 감안 1일) → 초록');
  sf.content = JSON.stringify({latest:{date:dayAgo(2)}});
  ok(post({action:'queue_status', key:K2}).toss.state==='warn', '2일 → 노랑');
  sf.content = JSON.stringify({latest:{date:dayAgo(5)}});
  ok(post({action:'queue_status', key:K2}).toss.state==='bad', '5일 → 빨강');
  sf.content = 'not json';
  q = post({action:'queue_status', key:K2});
  ok(q.toss.state==='ok' && q.toss.date===TODAY, '깨진 스냅샷은 파일 수정 시각으로 대신');
  sf.setTrashed(true);
  ok(post({action:'queue_status', key:K2}).toss.state==='unknown', '스냅샷이 없으면 unknown');

  ok(post({action:'queue_status'}).error==='unauthorized', '키 없이는 상태도 안 줌');
  ok(post({action:'queue_status', key:'x'.repeat(64)}).error==='unauthorized', '틀린 키도 거절');
}

console.log('9) 🤖 오더함 (queue_list · queue_enqueue · queue_decide)');
{
  const K3 = S.props.SECRET_KEY;
  const SHEET = 'SHEETidForOrderBox01';
  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const canon = v => v === null || v === undefined ? 'null' : typeof v !== 'object' ? JSON.stringify(v)
    : Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
    : '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  const hashOf = o => nodeCrypto.createHash('sha256').update(canon(o), 'utf8').digest('hex');
  const setQ = rows => S.addSheet(SHEET, {'Command_Queue': [HEAD.slice(0)].concat(rows)});
  const qrows = () => S.books[SHEET]['Command_Queue'];
  const qrow = (id, created, status, extra) => {
    const r = [id, created, 'phone', 'git_pull', 'gaegyebu', '{}', status, 0, '', '', ''];
    while (r.length < HEAD.length) r.push('');
    Object.keys(extra || {}).forEach(k => { const i = HEAD.indexOf(k); if (i >= 0) r[i] = extra[k]; });
    return r;
  };
  const lastRow = () => qrows()[qrows().length - 1];
  const col = (row, n) => row[HEAD.indexOf(n)];
  const audit = () => S.books[SHEET]['Audit_Log'];

  // ① 설정 전 — 예외 없이 noconfig
  delete S.props.QUEUE_SHEET_ID;
  let q = post({action: 'queue_list', key: K3});
  ok(q.ok === false && q.code === 'noconfig', 'QUEUE_SHEET_ID 가 없으면 예외 없이 noconfig');
  q = post({action: 'queue_enqueue', key: K3, type: 'git_pull', workspace: 'gaegyebu', payload: {}});
  ok(q.ok === false && q.code === 'noconfig', '접수도 설정 전엔 noconfig');
  q = post({action: 'queue_decide', key: K3, id: 'Q-none', decision: 'approve'});
  ok(q.ok === false && q.code === 'noconfig', '승인도 설정 전엔 noconfig');

  // ② 빈 큐
  S.props.QUEUE_SHEET_ID = SHEET;
  setQ([]);
  q = post({action: 'queue_list', key: K3});
  ok(q.ok === true && q.items.length === 0 && q.count === 0, '빈 큐는 빈 목록');
  ok(Array.isArray(q.workspaces) && q.workspaces.indexOf('gaegyebu') >= 0 && q.workspaces.indexOf('content-hub') >= 0, '고를 수 있는 작업 위치 목록을 준다');
  ok(JSON.stringify(q.types) === JSON.stringify(['git_pull','toss_sync','claude_prompt']), '접수 가능한 오더는 git_pull · toss_sync · claude_prompt');
  ok(q.approval_ttl_min === 15, '승인 기한 15분');
  ok(!JSON.stringify(q).includes(SHEET) && !JSON.stringify(q).includes('SHEETid'), '목록 응답에 시트 ID 가 없다');

  // ③ git_pull 접수 → Command_Queue 한 줄 (22칸)
  let n = qrows().length;
  let r = post({action: 'queue_enqueue', key: K3, type: 'git_pull', workspace: 'gaegyebu', payload: {}});
  ok(r.ok === true && r.duplicate === false && r.item.status === 'PENDING', 'git_pull 은 바로 PENDING');
  ok(r.item.risk_level === 'LOW' && r.item.needs_decision === false, 'git_pull 은 승인 대상이 아니다');
  ok(qrows().length === n + 1 && lastRow().length === HEAD.length, 'Command_Queue 에 22칸 한 줄이 붙는다');
  ok(col(lastRow(), 'source') === 'portal' && col(lastRow(), 'type') === 'git_pull' && col(lastRow(), 'workspace') === 'gaegyebu', 'source=portal · type · workspace 기록');
  ok(col(lastRow(), 'payload') === '{}', 'git_pull payload 는 빈 객체(워커 규격)');
  ok(/^Q-\d{8}-\d{6}-[a-z0-9]{4}$/.test(String(col(lastRow(), 'id'))), 'id 는 Q-yyyymmdd-HHmmss-xxxx');
  ok(col(lastRow(), 'approval_hash') === hashOf({}), 'payload 해시 = canonical JSON SHA-256 (CommandQueue.gs 와 같은 값)');
  ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(String(col(lastRow(), 'created_at'))), 'created_at 은 Asia/Seoul ISO(+09:00)');
  ok(col(lastRow(), 'status') === 'PENDING' && col(lastRow(), 'attempts') === 0, 'status=PENDING · attempts=0');

  // ④ 중복 방지(비멱등) / 멱등은 그대로
  const ask1 = post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 'gaegyebu', payload: {prompt: '주간 지출 점검', mode: 'ask'}});
  ok(ask1.ok === true && ask1.item.status === 'PENDING', 'claude_prompt(ask) 는 PENDING');
  n = qrows().length;
  const ask2 = post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 'gaegyebu', payload: {prompt: '주간 지출 점검', mode: 'ask'}});
  ok(ask2.ok === true && ask2.duplicate === true && ask2.item.id === ask1.item.id && qrows().length === n, '같은 비멱등 오더는 새 줄 없이 기존 id 를 돌려준다(연타 방지)');
  const pull2 = post({action: 'queue_enqueue', key: K3, type: 'git_pull', workspace: 'gaegyebu', payload: {}});
  ok(pull2.ok === true && pull2.duplicate === false, '멱등(git_pull)은 중복을 막지 않는다');

  // ⑤ 파일 수정 오더 → 허용 4개 레포는 자동 승인(PENDING), 포털·금지지시는 승인 대기
  const ed = post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 'content-hub', payload: {prompt: '제목 고쳐줘', mode: 'edit'}});
  ok(ed.ok === true && ed.item.status === 'PENDING' && ed.item.risk_level === 'HIGH', '일반 레포(콘텐츠허브) mode=edit 은 자동 승인으로 바로 PENDING', ed);
  ok(ed.item.auto_approved === true && ed.item.needs_decision === false, '자동 승인 표시가 내려오고 승인 버튼은 필요 없다');
  ok(/자동 승인/.test(String(ed.note)), '접수 안내가 자동 승인이라고 말한다', ed.note);
  const autoRow = qrows().find(x => x[0] === ed.item.id);
  ok(col(autoRow, 'approval_by') === 'auto' && String(col(autoRow, 'approval_note')).indexOf('위임된') >= 0, '시트에 approval_by=auto 로 감사 기록');
  ok(col(autoRow, 'approval_expires_at') === '', '자동 승인에는 15분 기한을 걸지 않는다');
  for (const ws of ['gaegyebu', 'insurance-manager', 'smartstore-hub']) {
    const x = post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: ws, payload: {prompt: ws + ' 문구 고쳐줘', mode: 'edit'}});
    ok(x.ok === true && x.item.status === 'PENDING' && x.item.auto_approved === true, '자동 승인 대상: ' + ws, x);
  }
  const portalEd = post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 's2ongrae.github.io', payload: {prompt: '카드 문구 고쳐줘', mode: 'edit'}});
  ok(portalEd.ok === true && portalEd.item.status === 'WAITING_APPROVAL' && portalEd.item.needs_decision === true, '포털(제어면) 수정은 계속 승인 대기', portalEd);
  const dangerEd = post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 'smartstore-hub', payload: {prompt: 'git reset --hard 하고 고쳐줘', mode: 'edit'}});
  ok(dangerEd.ok === true && dangerEd.item.status === 'WAITING_APPROVAL', '금지 지시(reset --hard)가 있으면 승인 대기로 남는다', dangerEd);
  ok(post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 'smartstore-hub', payload: {prompt: '.env 에 키 추가해줘', mode: 'edit'}}).item.status === 'WAITING_APPROVAL', '.env 를 건드리는 지시는 승인 대기');
  ok(post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 'gaegyebu', payload: {prompt: '지출 화면 고쳐줘', mode: 'edit'}}).item.status === 'PENDING', '평범한 수정 지시는 자동');
  const ed2 = post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 's2ongrae.github.io', payload: {prompt: '승인 카드 색 고쳐줘', mode: 'edit'}});
  ok(ed2.ok === true && ed2.item.status === 'WAITING_APPROVAL' && ed2.item.risk_level === 'HIGH', '포털 mode=edit 은 WAITING_APPROVAL(HIGH)', ed2);
  ok(ed2.item.needs_decision === true && ed2.item.expires_in_ms > 14 * 60000 && ed2.item.expires_in_ms <= 15 * 60000, '승인 기한 15분이 잡힌다');
  const editId = ed2.item.id;
  const edRow = qrows().find(x => x[0] === editId);
  ok(col(edRow, 'approval_expires_at') && col(edRow, 'approval_by') === '', '기한은 적고 승인자는 아직 비어 있다');
  ok(col(edRow, 'approval_hash') === hashOf({prompt: '승인 카드 색 고쳐줘', mode: 'edit'}), '승인 해시가 payload 와 묶인다');
  ok(post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 'content-hub', payload: {prompt: '   ', mode: 'edit'}}).code === 'bad_request', '빈 오더 거절');

  // ⑤-2 AI 엔진 — payload.engine 이 워커까지 가도록 그대로 싣는다
  const engQ = post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 'gaegyebu', payload: {prompt: '제미나이로 요약', mode: 'ask', engine: 'agy'}});
  ok(engQ.ok === true, '엔진을 붙인 오더도 접수');
  const engRow = qrows().find(x => x[0] === engQ.item.id);
  const engPayload = JSON.parse(String(col(engRow, 'payload')));
  ok(engPayload.engine === 'agy' && engPayload.prompt === '제미나이로 요약' && engPayload.mode === 'ask', 'payload 에 engine 이 실린다(예전엔 버려졌음)', engPayload);
  ok(col(engRow, 'approval_hash') === hashOf({prompt: '제미나이로 요약', mode: 'ask', engine: 'agy'}), '승인 해시가 engine 까지 묶는다');
  ok(String(engQ.item.summary).indexOf('엔진 agy') >= 0, '목록 요약에 엔진이 보인다', engQ.item.summary);
  const engAuto = post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 'gaegyebu', payload: {prompt: '기본으로', mode: 'ask', engine: 'auto'}});
  ok(JSON.parse(String(col(qrows().find(x => x[0] === engAuto.item.id), 'payload'))).engine === undefined, 'auto 는 payload 에 넣지 않는다(워커 기본값)');
  const engEdit = post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 'content-hub', payload: {prompt: '고쳐줘', mode: 'edit', engine: 'free'}});
  ok(engEdit.ok === false && engEdit.code === 'bad_request', '모르는 엔진 이름은 거절(조용히 auto 로 바꾸지 않음)', engEdit);
  ok(post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 'content-hub', payload: {prompt: '고쳐줘', mode: 'edit', engine: 'AGY'}}).ok === true, '대문자 엔진 이름은 받아준다');
  q = post({action: 'queue_list', key: K3});
  ok(Array.isArray(q.engines) && q.engines.join(',') === 'auto,claude,agy,freellmapi', '목록 응답에 엔진 4종', q.engines);

  // ⑥ 타입·워크스페이스 화이트리스트
  for (const t of ['git_push', 'smartstore_api_relay', 'rm_rf']) {
    const x = post({action: 'queue_enqueue', key: K3, type: t, workspace: 'gaegyebu', payload: {}});
    ok(x.ok === false && x.code === 'type', `허용하지 않은 오더 타입 거절: ${t}`);
  }
  ok(post({action: 'queue_enqueue', key: K3, type: 'git_pull', workspace: '../etc', payload: {}}).code === 'workspace', '이상한 워크스페이스 거절');
  ok(post({action: 'queue_enqueue', key: K3, type: 'git_pull', workspace: 'unknown-ws', payload: {}}).code === 'workspace', '허용 목록 밖 워크스페이스 거절');
  ok(post({action: 'queue_enqueue', key: K3, type: 'git_pull', payload: {}}).code === 'workspace', '워크스페이스 없는 git_pull 거절');
  ok(post({action: 'queue_enqueue', key: K3, type: 'toss_sync', payload: {}}).ok === true, 'toss_sync 는 워크스페이스 없이 접수');
  ok(post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 'gaegyebu', payload: {prompt: 'x'.repeat(2001)}}).code === 'too_long', '2,000자를 넘는 오더 거절');
  const longOk = post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 'gaegyebu', payload: {prompt: 'x'.repeat(2000)}});
  ok(longOk.ok === true, '2,000자까지는 접수');

  // ⑦ 목록 — 최신 순 · 요약 · 개인정보 가림
  const mask = post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 'gaegyebu', payload: {prompt: '연락처 010-1234-5678 로 900101-1234567 확인해줘'}});
  ok(mask.ok === true, '개인정보가 든 오더도 접수는 된다(실행에는 원문 필요)');
  ok(qrows().find(x => x[0] === mask.item.id)[5].indexOf('010-1234-5678') >= 0, '시트에는 원문이 남는다');
  q = post({action: 'queue_list', key: K3, limit: 50});
  ok(q.ok === true && q.items.length <= 20, '목록은 최대 20건');
  ok(q.items[0].id === mask.item.id, '목록은 최신이 위');
  const listText = JSON.stringify(q);
  ok(listText.indexOf('010-1234-5678') < 0 && listText.indexOf('900101-1234567') < 0 && listText.indexOf('[REDACTED]') >= 0, '목록에는 주민·전화번호가 [REDACTED]');
  ok(listText.indexOf('"payload"') < 0, '목록에 payload 원문이 없고 한 줄 요약만 나간다');
  ok(q.items[0].summary.indexOf('클로드: ') === 0 && q.items[0].summary.length < 200, '요약은 짧게 줄인다');
  const longSummary = q.items.filter(i => i.id === longOk.item.id)[0];
  ok(longSummary && longSummary.summary.length <= 201, '긴 오더 요약도 길이를 자른다');
  ok(q.pending >= 2 && q.waiting >= 1, '건수(PENDING·승인 대기)를 같이 준다');

  // ⑧ 승인 → PENDING + Audit_Log
  let dec = post({action: 'queue_decide', key: K3, id: editId, decision: 'approve'});
  ok(dec.ok === true && dec.changed === true && dec.status === 'PENDING', '승인하면 PENDING 으로 내려간다');
  const aRow = qrows().find(x => x[0] === editId);
  ok(col(aRow, 'status') === 'PENDING' && col(aRow, 'approval_by') === 'portal' && !!col(aRow, 'approval_at'), '승인자·시각 기록');
  ok(Array.isArray(audit()) && audit()[0][0] === 'at' && audit().some(a => a[1] === editId && a[5] === 'approve' && a[6] === 'portal' && a[7] === 'portal'), 'Audit_Log 에 approve/portal 기록');
  const aForEdit = (audit() || []).find(a => a[1] === editId) || [];
  ok(String(aForEdit[9]) === hashOf({prompt: '승인 카드 색 고쳐줘', mode: 'edit'}), '감사 기록에 payload 해시가 남는다');
  dec = post({action: 'queue_decide', key: K3, id: editId, decision: 'approve'});
  ok(dec.ok === true && dec.changed === false && /이미 승인/.test(dec.note), '이미 승인된 오더를 또 승인하면 changed=false 로 알려준다');

  // ⑨ 거절
  const rj = post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 's2ongrae.github.io', payload: {prompt: '지우지 마', mode: 'edit'}});
  const rjd = post({action: 'queue_decide', key: K3, id: rj.item.id, decision: 'deny'});
  ok(rjd.ok === true && rjd.status === 'REJECTED', 'deny 도 거절로 처리');
  ok(String(col(qrows().find(x => x[0] === rj.item.id), 'error')).indexOf('승인 거절') === 0, '거절 사유를 적는다');
  ok((audit() || []).some(a => a[1] === rj.item.id && a[5] === 'reject'), '거절도 Audit_Log 에 남는다');
  ok(post({action: 'queue_decide', key: K3, id: rj.item.id, decision: 'approve'}).code === 'not_waiting', '이미 거절된 오더는 다시 결정할 수 없다');

  // ⑩ 기한 만료 — 승인 없는 실행 금지
  const ex = post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 's2ongrae.github.io', payload: {prompt: '늦게 승인', mode: 'edit'}});
  S.tick(16 * 60000);
  const exd = post({action: 'queue_decide', key: K3, id: ex.item.id, decision: 'approve'});
  ok(exd.ok === false && exd.code === 'expired', '기한(15분)이 지나면 승인할 수 없다');
  const exRow = qrows().find(x => x[0] === ex.item.id);
  ok(col(exRow, 'status') === 'EXPIRED' && /지나/.test(String(col(exRow, 'error'))), 'EXPIRED 로 마감(실행 안 함)');
  ok((audit() || []).some(a => a[1] === ex.item.id && a[5] === 'expired'), '만료도 Audit_Log 에 남는다');

  // ⑪ 해시 불일치
  const hx = post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 's2ongrae.github.io', payload: {prompt: '해시 시험', mode: 'edit'}});
  const mm = post({action: 'queue_decide', key: K3, id: hx.item.id, decision: 'approve', payload_hash: '0'.repeat(64)});
  ok(mm.ok === false && mm.code === 'hash_mismatch', '승인하려는 내용(해시)이 다르면 거절');
  ok(col(qrows().find(x => x[0] === hx.item.id), 'status') === 'WAITING_APPROVAL', '해시가 다르면 상태도 그대로');
  ok((audit() || []).some(a => a[1] === hx.item.id && a[5] === 'mismatch'), '해시 불일치도 Audit_Log 에 남는다');
  const mm2 = post({action: 'queue_decide', key: K3, id: hx.item.id, decision: 'approve', payload_hash: hashOf({prompt: '해시 시험', mode: 'edit'})});
  ok(mm2.ok === true && mm2.status === 'PENDING', '해시가 맞으면 승인된다');

  // ⑫ 없는 id · 이상한 결정 · 잠금
  ok(post({action: 'queue_decide', key: K3, id: 'Q-nope-000000-zzzz', decision: 'approve'}).code === 'not_found', '없는 오더 id 안내');
  ok(post({action: 'queue_decide', key: K3, id: hx.item.id, decision: 'maybe'}).code === 'bad_request', 'approve/reject 외 결정 거절');
  ok(post({action: 'queue_decide', key: K3, id: '', decision: 'approve'}).code === 'bad_request', '빈 id 거절');
  n = qrows().length;
  S.setLock(true);
  const busy = post({action: 'queue_enqueue', key: K3, type: 'toss_sync', payload: {}});
  S.setLock(false);
  ok(busy.ok === false && busy.code === 'busy' && qrows().length === n, '잠금 중이면 접수하지 않고 busy 로 알려준다');

  // ⑬ 예전 시트·탭 없음 → 쓰지 않고 안내
  S.addSheet('SHEETidOldQueue0001', {'Command_Queue': [HEAD.slice(0, 11)]});
  S.props.QUEUE_SHEET_ID = 'SHEETidOldQueue0001';
  ok(post({action: 'queue_list', key: K3}).code === 'schema', '예전 11칸 시트는 schema 안내(빨간 에러 아님)');
  ok(post({action: 'queue_enqueue', key: K3, type: 'toss_sync', payload: {}}).code === 'schema', '예전 시트에는 쓰지 않는다');
  S.addSheet('SHEETidNoTab0001', {'다른탭': [['a']]});
  S.props.QUEUE_SHEET_ID = 'SHEETidNoTab0001';
  ok(post({action: 'queue_list', key: K3}).code === 'schema', 'Command_Queue 탭이 없으면 schema 안내');
  S.props.QUEUE_SHEET_ID = 'SHEETidMissing0001';
  ok(post({action: 'queue_list', key: K3}).code === 'unreachable', '시트를 못 열면 unreachable 안내');
  S.props.QUEUE_SHEET_ID = SHEET;

  // ⑬-2 포털 관제 — 누가·언제 집어 갔는지(claimed_at·claimed_by)도 목록에 준다
  setQ([qrow('Q-20261116-173532-gde8', '2026-11-16T17:35:32+09:00', 'RUNNING',
    {type: 'claude_prompt', workspace: 'content-hub', claimed_at: '2026-11-16T17:36:02+09:00', claimed_by: 'notebook',
      payload: JSON.stringify({prompt: '점검', mode: 'ask'})})]);
  S.props.QUEUE_SHEET_ID = SHEET;
  const runQ = post({action: 'queue_list', key: K3});
  ok(runQ.items[0].claimed_at === '2026-11-16T17:36:02+09:00' && runQ.items[0].claimed_by === 'notebook',
    '실행 중 오더의 시작 시각·집어간 곳을 준다(포털이 경과 시간·정체를 판단)', runQ.items[0]);
  ok(runQ.running === 1 && runQ.pending === 0, '목록 요약에 RUNNING 건수도 같이');

  // ⑭ 사후 게이트(2026-11-18) — REVIEW_NEEDED 는 검토 필요로 내려오고 브랜치·사유·변경 요약이 함께 온다
  {
    const HEAD26 = HEAD.concat(['branch', 'block_reason', 'diff_summary', 'changed_files']);
    const SHEET26 = 'SHEETidGate26Cols01';
    const gateVals = {
      id: 'Q-20261118-120000-gate', created_at: '2026-11-18T12:00:00+09:00', source: 'pickle',
      type: 'claude_prompt', workspace: 'content-hub', payload: JSON.stringify({ prompt: '고쳐줘', mode: 'edit' }),
      status: 'REVIEW_NEEDED', attempts: 0, claimed_at: '2026-11-18T12:00:01+09:00', claimed_by: 'notebook',
      finished_at: '2026-11-18T12:03:00+09:00', duration_ms: 180000, exit_code: 0, result: '게이트 보류',
      risk_level: 'LOW', approval_by: 'auto', approval_at: '2026-11-18T12:00:00+09:00',
      approval_note: '위임된 일반 코드 작업', approval_hash: 'abcdef',
      branch: 'auto-review/Q-20261118-120000-gate', block_reason: '게이트 보류 — 민감 경로를 건드렸습니다(.env)',
      diff_summary: '3개 파일 +20/-4', changed_files: 'a.js, b.js, c.js'
    };
    const gateRow = HEAD26.map(n => (gateVals[n] === undefined ? '' : gateVals[n]));
    S.addSheet(SHEET26, {'Command_Queue': [HEAD26.slice(), gateRow]});
    S.props.QUEUE_SHEET_ID = SHEET26;
    const gq = post({ action: 'queue_list', key: K3 });
    const gi = gq.items[0];
    ok(gi && gi.status === 'REVIEW_NEEDED' && gi.needs_decision === false, '검토 필요 상태로 내려오고 승인 버튼은 필요 없다', gi);
    ok(gi.branch === 'auto-review/Q-20261118-120000-gate' && /민감 경로/.test(gi.block_reason) && gi.diff_summary === '3개 파일 +20/-4',
      '브랜치·차단 사유·변경 요약을 함께 준다(포털이 compare 링크를 만든다)', gi);
    ok(gi.changed_files === 'a.js, b.js, c.js', '바뀐 파일 목록도 준다');
    ok(gq.review === 1, '목록 건수에 검토 필요가 잡힌다');
    const gs = post({ action: 'queue_status', key: K3 });
    ok(gs.ok === true && gs.queue && gs.queue.review === 1, '상태등(queue_status)에도 검토 필요 건수', gs.queue);
    // 예전 22칸 시트에서는 새 칸이 없어도 빈 값으로 안전하게 내려온다(하위호환)
    setQ([qrow('Q-20261118-121500-old', '2026-11-18T12:15:00+09:00', 'DONE')]);
    S.props.QUEUE_SHEET_ID = SHEET;
    const oldQ = post({ action: 'queue_list', key: K3 });
    ok(oldQ.items[0].branch === '' && oldQ.items[0].block_reason === '' && oldQ.items[0].diff_summary === '',
      '예전 시트(22칸)에서는 게이트 칸이 빈 값으로 내려와 화면이 깨지지 않는다', oldQ.items[0]);
  }

  // ⑭ 응답 전체에 시트 ID·비밀 키가 없다
  const all = JSON.stringify([post({action: 'queue_list', key: K3}),
    post({action: 'queue_enqueue', key: K3, type: 'toss_sync', payload: {}})]);
  ok(all.indexOf(SHEET) < 0 && all.indexOf(K3) < 0, '오더함 응답에 시트 ID·비밀 키가 없다');
}

console.log('10) 🤖 피클 상태 파일 (agent_status) — 드라이브 포털_에이전트상태.json');
{
  const K4 = S.props.SECRET_KEY;
  const nowMs = S.run('Date.now()');
  const at = ms => new Date(ms).toISOString();
  let r = post({action: 'agent_status', key: K4});
  ok(r.ok === true && typeof r.connected === 'boolean' && !r.agent, '폴더·파일이 아직 없어도 예외 없이 상태만 돌려준다');

  const found = S.ROOT.folders.filter(f => f.name === '김성래포털');
  const folder = found.length ? found[0] : S.ROOT.createFolder('김성래포털');
  r = post({action: 'agent_status', key: K4});
  ok(r.ok === true && (r.connected === false ? /기록이 없|폴더/.test(String(r.note || '')) : true), '상태 파일이 없으면 기록 없음 안내');

  const f = folder.createFile('포털_에이전트상태.json', JSON.stringify({
    version: 1, updated_at: at(nowMs - 3 * 60000),
    agent: {state: 'working', task: '포털 관제 개선', project: 'portal', started_at: at(nowMs - 20 * 60000), id: 't1'},
    tasks: [
      {id: 't1', project: 'portal', title: '포털 관제 개선', state: 'working', started_at: at(nowMs - 20 * 60000)},
      {id: 't0', project: 'gaegyebu', title: '가계부 점검 010-1234-5678', state: 'done', started_at: at(nowMs - 90 * 60000), ended_at: at(nowMs - 60 * 60000), result: '공모주 일정 정리 완료'}
    ]
  }));
  r = post({action: 'agent_status', key: K4});
  ok(r.ok === true && r.connected === true && r.min === 3, '최근 갱신 시각과 나이(분)를 준다');
  ok(r.agent && r.agent.state === 'working' && r.agent.task === '포털 관제 개선' && r.agent.project === 'portal' && r.agent.stale === false, '지금 하는 일·프로젝트·정체 여부');
  ok(Array.isArray(r.tasks) && r.tasks.length === 2 && r.tasks[1].ended_at && r.tasks[1].result === '공모주 일정 정리 완료', '최근 작업 목록과 결과');
  ok(JSON.stringify(r).indexOf('010-1234-5678') < 0 && JSON.stringify(r).indexOf('[REDACTED]') >= 0, '제목의 전화번호는 가려서 내보낸다');
  ok(!JSON.stringify(r).includes(f.id), '파일 ID 는 응답에 넣지 않는다');

  f.content = JSON.stringify({updated_at: at(nowMs - 45 * 60000), agent: {state: 'working', task: '오래 걸리는 일', project: 'portal'}, tasks: []});
  r = post({action: 'agent_status', key: K4});
  ok(r.agent.stale === true && r.stale === true, '30분 넘게 갱신이 없으면 stale 로 표시');

  f.content = JSON.stringify({updated_at: at(nowMs), agent: {state: 'idle'}, tasks: [{id: 'x'}]});
  r = post({action: 'agent_status', key: K4});
  ok(r.agent.state === 'idle' && r.agent.stale === false && r.tasks[0].title === '', '쉬는 중이면 stale 아님, 모자란 칸은 빈 값');

  f.content = 'not json';
  r = post({action: 'agent_status', key: K4});
  ok(r.ok === true && r.connected === false && /읽을 수 없/.test(String(r.note || '')), '깨진 파일은 예외 없이 안내');

  f.content = JSON.stringify({version: 1, updated_at: at(nowMs), agent: {state: 'idle'}, tasks: new Array(40).fill({id: 'y', title: 'x', state: 'done'})});
  r = post({action: 'agent_status', key: K4});
  ok(r.tasks.length <= 12, '작업 목록은 최대 12건만 내보낸다');
  ok(post({action: 'agent_status', key: 'x'.repeat(64)}).error === 'unauthorized', '키 없이는 피클 상태도 안 준다');
}

console.log('11) ⌨️ 노트북 직접작업 상태 (agent_beat) — 드라이브 포털_agent_직접.json');
{
  const K5 = S.props.SECRET_KEY;
  let r = post({action:'agent_beat', key:K5, state:'working', project:'portal', task:'포털 관제 010-1234-5678'});
  ok(r.ok===true && r.state==='working', 'working 상태를 받아 기록');
  const folder = S.ROOT.folders.filter(f=>f.name==='김성래포털')[0];
  const f = folder && folder.files.filter(x=>x.name==='포털_agent_직접.json')[0];
  ok(!!f, '드라이브에 직접작업 상태 파일이 생긴다');
  const d1 = JSON.parse(f.content);
  ok(d1.agent.state==='working' && d1.agent.project==='portal' && String(d1.agent.task).indexOf('010-1234-5678')<0, '작업명의 전화번호는 가려서 저장');
  ok(!!Date.parse(d1.updated_at) && !!Date.parse(d1.agent.started_at), '갱신·시작 시각을 남긴다');

  r = post({action:'agent_status', key:K5});
  ok(r.ok===true && r.direct && r.direct.state==='working' && r.direct.project==='portal', 'agent_status 에 direct 블록이 붙는다');
  ok(typeof r.direct.min==='number' && r.direct.min>=0, 'direct 에 경과 분(min)을 준다');

  r = post({action:'agent_beat', key:K5, state:'idle'});
  const d2 = JSON.parse(f.content);
  ok(r.ok===true && d2.agent.state==='idle', 'idle 이면 쉬는 중으로');
  ok(d2.history.length===1 && d2.history[0].project==='portal' && typeof d2.history[0].dur_min==='number', 'idle 때 이력 한 줄(프로젝트·소요 분)');

  r = post({action:'agent_beat', key:K5, state:'SLEEP', project:'x'});
  ok(r.ok===true && JSON.parse(f.content).agent.state==='working', '이상한 state 는 working 으로 정규화');

  for(let i=0;i<12;i++){ post({action:'agent_beat', key:K5, state:'working', project:'p'+i}); post({action:'agent_beat', key:K5, state:'idle'}); }
  ok(JSON.parse(f.content).history.length<=8, '이력은 최대 8건만 보관');

  S.setLock(true);
  r = post({action:'agent_beat', key:K5, state:'working'});
  ok(r.ok===false, '동시 저장(잠금) 중이면 거절');
  S.setLock(false);

  f.content='not json';
  r = post({action:'agent_status', key:K5});
  ok(r.ok===true && !r.direct, '직접작업 파일이 깨져도 예외 없이 direct 없이 응답');
}

console.log('12) 💻 회사 PC 비트(agent_beat target=pc) — 비공개 레포 작업·커밋 전 상태');
{
  const K6 = S.props.SECRET_KEY;
  const folder = S.ROOT.folders.filter(x=>x.name==='김성래포털')[0];
  const pcFile = ()=>folder.files.filter(x=>x.name==='포털_agent_pc.json')[0];

  // ① target 을 주면 pc 파일에 따로 쌓이고, direct 파일은 건드리지 않는다
  let d = post({action:'agent_beat', key:K6, target:'direct', state:'working', project:'portal', task:'노트북 작업'});
  ok(d.ok===true && d.target==='direct', 'target=direct 는 direct 로 기록');
  const directBefore = JSON.parse(folder.files.filter(x=>x.name==='포털_agent_직접.json')[0].content).updated_at;
  let r = post({action:'agent_beat', key:K6, target:'pc', state:'working', project:'smartstore', task:'상품 상세페이지 수정'});
  ok(r.ok===true && r.target==='pc' && r.state==='working', 'target=pc 를 받는다');
  ok(!!pcFile(), 'pc 상태 파일(포털_agent_pc.json)이 따로 생긴다');
  const pd = JSON.parse(pcFile().content);
  ok(pd.agent.state==='working' && pd.agent.project==='smartstore' && pd.target==='pc', 'pc 파일에 상태·프로젝트·target 기록');
  ok(JSON.parse(folder.files.filter(x=>x.name==='포털_agent_직접.json')[0].content).updated_at===directBefore, 'pc 비트는 direct 파일을 덮어쓰지 않는다');

  // ② agent_status 가 direct·pc 를 같이 준다
  r = post({action:'agent_status', key:K6});
  ok(r.ok===true && r.pc && r.pc.state==='working' && r.pc.project==='smartstore', 'agent_status 에 pc 블록이 붙는다');
  ok(r.direct && r.direct.project==='portal', 'direct 블록도 그대로');
  ok(JSON.stringify(r.beat_targets)===JSON.stringify(['direct','pc']), 'beat_targets 로 이 배포가 pc 를 아는지 알려준다');

  // ③ stale_min — 커밋 알림은 120분, 값은 5~240 으로 자른다
  r = post({action:'agent_beat', key:K6, target:'pc', state:'working', source:'commit', stale_min:120, project:'smartstore', task:'커밋'});
  ok(r.ok===true && r.stale_min===120, '커밋 알림의 stale_min 120 을 그대로 받는다');
  ok(post({action:'agent_status', key:K6}).pc.stale_min===120, 'agent_status 가 stale_min 을 실어 준다');
  ok(post({action:'agent_beat', key:K6, target:'pc', stale_min:9999}).stale_min===240, '너무 큰 stale_min 은 240 으로 자름');
  ok(post({action:'agent_beat', key:K6, target:'pc', stale_min:3}).stale_min===5, '5분 아래는 5분으로 올림');
  ok(post({action:'agent_beat', key:K6, target:'pc', stale_min:0}).stale_min===30, '0 이하는 값이 없는 것으로 보고 30분');
  ok(post({action:'agent_beat', key:K6, target:'pc'}).stale_min===30, '안 주면 30분');

  // ④ 가림 — 작업명의 전화번호는 저장 전에 지운다
  r = post({action:'agent_beat', key:K6, target:'pc', state:'working', project:'smartstore', task:'고객 010-1234-5678 안내'});
  ok(String(JSON.parse(pcFile().content).agent.task).indexOf('010-1234-5678')<0, 'pc 작업명의 전화번호도 가려서 저장');

  // ⑤ idle 이면 이력 한 줄 + 쉬는 중
  r = post({action:'agent_beat', key:K6, target:'pc', state:'idle', source:'commit'});
  const pd2 = JSON.parse(pcFile().content);
  ok(pd2.agent.state==='idle' && pd2.history.length>=1 && typeof pd2.history[0].dur_min==='number', 'pc idle 이면 이력 한 줄');
  ok(post({action:'agent_status', key:K6}).pc.state==='idle', 'agent_status 도 쉬는 중으로');

  // ⑥ 모르는 target 은 예전 그대로 direct (free 함수 하위호환)
  r = post({action:'agent_beat', key:K6, target:'tablet', state:'working', project:'portal', task:'x'});
  ok(r.ok===true && r.target==='direct', '모르는 target 은 direct 로');

  // ⑦ pc 파일이 깨져도 direct 는 그대로 온다
  pcFile().content='not json';
  r = post({action:'agent_status', key:K6});
  ok(r.ok===true && !r.pc && !!r.direct, 'pc 파일이 깨져도 예외 없이 direct 만 응답');
}

console.log('13) 💻 회사 PC 1줄 리포터(tools/pc-beat.ps1) — 키 없는 공개 도구');
{
  const fs = require('fs'), path = require('path');
  const p = path.join(__dirname, '..', 'tools', 'pc-beat.ps1');
  const ps = fs.readFileSync(p, 'utf8');
  ok(ps.length > 2000, 'pc-beat.ps1 이 있다');
  ok(/target\s*=\s*'pc'/.test(ps), "보내는 본문의 target 은 'pc'");
  ok(/action\s*=\s*'agent_beat'/.test(ps), 'action 은 agent_beat');
  ok(ps.indexOf('.portal-beat.json') >= 0 && ps.indexOf('USERPROFILE') >= 0, '키는 사용자 폴더(%USERPROFILE%)에만 둔다');
  ok(ps.indexOf('PC_BEAT_KEY') >= 0 && ps.indexOf('PC_BEAT_URL') >= 0, '환경변수로도 받는다');
  ok(!/script\.google\.com/.test(ps) && !/https?:\/\/[a-z0-9.-]+\/macros/.test(ps), '공개 저장소에 서버 주소를 넣지 않는다');
  ok(ps.indexOf('post-commit') >= 0 && ps.indexOf('pcbeat start') >= 0, '커밋 훅과 start/done 사용법을 안내한다');
  ok(ps.indexOf('StaleCommit = 120') >= 0, '커밋 알림은 120분 기준(커밋 간격)');
  ok(ps.indexOf('$ConfigPath') >= 0 && !/Add-Content[^\n]*\.portal-beat/.test(ps), '설정은 덮어쓰기(비밀번호가 로그에 안 쌓임)');

  // 가림 규칙은 .NET·JS 공통 문법 — 같은 정규식으로 여기서 시험한다
  const block = ps.match(/<PCBEAT_MASK>([\s\S]*?)<\/PCBEAT_MASK>/);
  ok(!!block, '가림 규칙 구간이 있다');
  const pats = [];
  const rc = /'((?:[^']|'')*)'/g; let mm;
  while ((mm = rc.exec(block ? block[1] : '')) !== null) pats.push(mm[1].replace(/''/g, "'"));
  ok(pats.length >= 4, '가림 규칙 4개 이상');
  const mask = s => { let t = String(s); pats.forEach(x => { t = t.replace(new RegExp(x, 'g'), '***'); }); return t.replace(/\s+/g, ' ').trim(); };
  ok(mask('고객 010-1234-5678 안내').indexOf('010-1234-5678') < 0, '작업명의 휴대전화는 가림');
  ok(mask('메일 a.b@c.co 로').indexOf('a.b@c.co') < 0, '작업명의 메일은 가림');
  ok(mask('주민 900101-1234567').indexOf('900101-1234567') < 0, '주민번호 모양은 가림');
  ok(mask('key 0123456789abcdef0123456789abcdef').indexOf('0123456789abcdef') < 0, '키 모양(32자 hex)은 가림');
  ok(mask('상품 상세페이지 수정 4건') === '상품 상세페이지 수정 4건', '보통 작업명은 그대로');
  ok(mask('x'.repeat(100)).length === 100, '가림은 길이를 늘리지 않는다(자르기는 서버가 60자로)');
}

console.log(`\n포털 서버 테스트: ${pass}건 통과, ${fail}건 실패`);
process.exit(fail?1:0);
