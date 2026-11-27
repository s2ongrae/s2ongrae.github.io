const mk = require('./lib/portal_fake_server.js');
const nodeCrypto = require('crypto');
let pass=0, fail=0; const ok=(c,m)=>{ if(c) pass++; else { fail++; console.log('  ❌',m); } };
const S = mk(), K = S.KEY, post = S.post;
const memo = (id,x={})=>Object.assign({id,title:'제목'+id,body:'내용'+id,color:'mc-blue',pinned:false,updatedAt:'2026-10-01T00:00:00Z'},x);

console.log('1) 접근 통제');
let r = S.doGet(); ok(r.ok===false && r.error==='POST로만 사용할 수 있어요.' && Object.keys(r).length===2, 'doGet은 안내 문구만(캘린더·메모 안 줌)');
for(const a of ['getTaskLists','getTasks','addTask','completeTask','deleteTask','getCalendarEvents','createEvent','deleteEvent','cal_list','cal_create','cal_update','loadMemos','saveMemos','ping','queue_status','queue_list','queue_enqueue','queue_decide','webhook_set','agent_beat']){
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

console.log('2-2) 🗓️ 일정 API — cal_list · cal_create · cal_update (큐 전담 · 2026-11-26)');
const evN = S.events.length;
r = post({action:'cal_create',key:K,title:'치과',start:'2026-10-14T14:00',end:'2026-10-14T15:00',location:'유성구 치과',description:'스케일링'});
ok(r.ok && r.created===true && /^ev/.test(r.id||''), '시간 일정 등록 — id·created');
ok(r.start==='2026-10-14T14:00' && r.end==='2026-10-14T15:00', '넣은 시각 그대로 돌려줌');
ok(r.location==='유성구 치과' && r.description==='스케일링' && r.allDay===false, '장소·설명 저장 · allDay=false');
const dentist = r.id;
r = post({action:'cal_create',key:K,title:'치과',start:'2026-10-14T14:00'});
ok(r.ok && r.duplicate===true && r.created===false && r.id===dentist, '같은 제목·같은 시작은 중복으로 보고 새로 만들지 않는다');
ok(S.events.length===evN+1, '중복일 때 일정이 늘지 않는다');
r = post({action:'cal_create',key:K,title:'치과',start:'2026-10-14T14:00',allowDuplicate:true});
ok(r.ok && r.created===true && r.id!==dentist, 'allowDuplicate 면 하나 더 만든다');
r = post({action:'cal_create',key:K,title:'짧은 통화',start:'2026-10-16 09:30'});
ok(r.ok && r.start==='2026-10-16T09:30' && r.end==='2026-10-16T10:30', '끝을 안 주면 1시간 · 공백 형식도 읽는다');
r = post({action:'cal_create',key:K,title:'제주 여행',start:'2026-10-15',end:'2026-10-16'});
ok(r.ok && r.allDay===true && r.start==='2026-10-15' && r.end==='2026-10-16', '종일 일정 — end 는 마지막 날(포함)');
ok(S.events.find(e=>e.id===r.id).end.getDate()===17, '구글 안쪽 끝 경계는 하루 뒤(17일 0시)');
const travel = r.id;
ok(post({action:'cal_create',key:K,start:'2026-10-14'}).ok===false && post({action:'cal_create',key:K,title:'   ',start:'2026-10-14'}).ok===false, '시작·제목이 없으면 거절');
for(const bad of ['2026-02-30','abc','2026-13-01','2026-10-14T25:00','x'.repeat(50)]){
  ok(post({action:'cal_create',key:K,title:'x',start:bad}).ok===false, `이상한 날짜 거절: ${bad.slice(0,12)}`);
}
r = post({action:'cal_list',key:K,start:'2026-10-14',end:'2026-10-14'});
ok(r.ok && r.total===2 && r.count===2, '하루 범위 조회(치과 2건)');
ok(r.items.every(x=>x.id&&x.title&&typeof x.allDay==='boolean'&&x.start&&x.end&&typeof x.location==='string'&&x.description!==undefined), '일정 모양(id·제목·시작·끝·종일·장소·설명)');
r = post({action:'cal_list',key:K});
ok(r.ok && r.start==='2026-10-13' && r.end==='2026-10-20', '기본 범위는 오늘부터 +7일(포함)');
r = post({action:'cal_list',key:K,start:'2026-10-13',end:'2026-10-19'});
ok(r.ok && r.total===4 && r.items[0].start <= r.items[1].start, '기간 안의 일정만 · 시작 빠른 순');
r = post({action:'cal_list',key:K,start:'2026-10-13',end:'2026-10-19',q:'치과'});
ok(r.ok && r.total===2, 'q 로 제목·장소·설명 검색');
r = post({action:'cal_list',key:K,start:'2026-10-13',end:'2026-10-19',limit:1});
ok(r.ok && r.count===1 && r.total===4, 'limit 은 돌려주는 수만 줄인다(total 은 전체)');
ok(post({action:'cal_list',key:K,start:'2026-10-20',end:'2026-10-14'}).ok===false, '끝이 시작보다 앞서면 거절');
r = post({action:'cal_list',key:K,start:'2026-10-01',end:'2027-06-01'});
ok(r.ok===false && r.code==='range_too_long', '너무 긴 기간은 range_too_long');
ok(JSON.parse(S.sb.doGet({parameter:{action:'cal_list',key:K}}).getContent()).code==='read_only', 'GET 으로는 일정을 안 준다(키가 URL·로그에 남지 않게)');
r = post({action:'cal_update',key:K,id:dentist,title:'치과(스케일링)',start:'2026-10-14T16:00',location:'관평동 치과'});
ok(r.ok && r.updated===true && r.title==='치과(스케일링)' && r.start==='2026-10-14T16:00', '제목·시각 수정');
ok(r.end==='2026-10-14T17:00', '시각만 옮기면 길이(1시간) 유지');
ok(r.location==='관평동 치과' && r.description==='스케일링', '안 보낸 장소·설명은 그대로 둔다');
r = post({action:'cal_update',key:K,id:'없는일정id'});
ok(r.ok===false && r.code==='event_not_found', '없는 일정은 event_not_found');
ok(post({action:'cal_update',key:K,id:''}).ok===false && post({action:'cal_update',key:K,id:dentist,title:'   '}).ok===false, 'id·빈 제목 거절');
ok(S.events.find(e=>e.id===dentist).title==='치과(스케일링)', '거절된 수정은 일정을 안 바꾼다');
r = post({action:'cal_update',key:K,id:dentist,allDay:true});
ok(r.ok && r.allDay===true && r.start==='2026-10-14' && r.end==='2026-10-14', '시간 일정 → 종일(그 날 하루)');
ok(post({action:'cal_update',key:K,id:dentist,allDay:false}).ok===false, '종일 → 시간은 시각을 같이 줘야 한다');
r = post({action:'cal_update',key:K,id:dentist,allDay:false,start:'2026-10-14T10:00',end:'2026-10-14T11:00'});
ok(r.ok && r.allDay===false && r.start==='2026-10-14T10:00' && r.end==='2026-10-14T11:00', '종일 → 시간(시각을 주면 바뀐다)');
r = post({action:'cal_update',key:K,id:travel,start:'2026-10-15',end:'2026-10-17'});
ok(r.ok && r.start==='2026-10-15' && r.end==='2026-10-17', '종일 기간 늘리기(end 포함)');
ok(post({action:'cal_delete',key:K,id:dentist}).ok===false && S.events.some(e=>e.id===dentist), '삭제는 없다(cal_delete 미지원 · 일정 그대로)');

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
  ok(q.heartbeat.state==='unknown' && q.heartbeat.source==='sheet' && q.heartbeat.min===2 && q.heartbeat.approx===true &&
    q.heartbeat.reason==='no_heartbeat', '하트비트 파일이 없으면 살아 있는지 모른다고 답한다(시트 활동은 참고값만·초록 금지)');

  // 2026-11-19 — 노트북이 폴링 때 남기는 Agent_Status 1행이 있으면 그걸로 살아 있음을 판정한다
  const abHead = ['updated_at','agent','state','order_id','script_version'];
  const setRowsWithBeat = (rows, beat) => S.addSheet('SHEETidForTest0001',
    { 'Command_Queue': [head].concat(rows), 'Agent_Status': [abHead].concat([beat]) });
  setRowsWithBeat([row('c1', iso(30), 'DONE', iso(2))], [iso(1), 'notebook', 'busy', 'Q-1', '2026-11-19-beat']);
  q = post({action:'queue_status', key:K2});
  ok(q.heartbeat.state==='ok' && q.heartbeat.source==='agent_status', '폴링 1분 전이면 초록(신호 있음)');
  ok(q.heartbeat.busy===true && q.heartbeat.order_id==='Q-1', '오더 실행 중(busy) 표시');
  ok(q.heartbeat.approx===false && q.heartbeat.min===1, '시트 활동 추정이 아니라 실제 신호');
  setRowsWithBeat([row('c1', iso(30), 'DONE', iso(2))], [iso(20), 'notebook', 'idle', '', '2026-11-19-beat']);
  q = post({action:'queue_status', key:K2});
  ok(q.heartbeat.state==='warn' && q.heartbeat.busy===false, '20분 전 신호면 노랑·대기 중');
  setRowsWithBeat([row('c1', iso(30), 'DONE', iso(2))], [iso(600), 'notebook', 'idle', '', '2026-11-19-beat']);
  ok(post({action:'queue_status', key:K2}).heartbeat.state==='bad', '10시간 전 신호면 빨강(노트북 멈춤)');
  S.addSheet('SHEETidForTest0001', { 'Command_Queue': [head].concat([row('c1', iso(30), 'DONE', iso(2))]), 'Agent_Status': [abHead] });
  ok(post({action:'queue_status', key:K2}).heartbeat.reason==='no_heartbeat', 'Agent_Status 가 비면 예전처럼 모른다고 답한다');

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
  ok(JSON.stringify(q.types) === JSON.stringify(['git_pull','toss_sync','claude_prompt','content_render']), '접수 가능한 오더는 git_pull · toss_sync · claude_prompt · content_render(영상 렌더, 항상 승인)');
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
  // 2026-11-19 — 접수 때 '워커 규칙' 문구가 자동으로 붙으므로, 해시는 저장된 payload 로 맞춰 본다.
  ok(col(edRow, 'approval_hash') === hashOf(JSON.parse(String(col(edRow, 'payload')))), '승인 해시가 payload 와 묶인다');
  ok(post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 'content-hub', payload: {prompt: '   ', mode: 'edit'}}).code === 'bad_request', '빈 오더 거절');

  // ⑤-2 영상 렌더(content_render) — 2026-11-20: 항상 승인 대기(HIGH), 입력은 파일 '이름'만
  const rp = {content_id: 'C-001', brand: 'daejeon_youth', inputs: ['외관 01.mp4', 'b.mov'], profile: 'captions'};
  const rn = post({action: 'queue_enqueue', key: K3, type: 'content_render', workspace: 'content-hub', payload: rp});
  ok(rn.ok === true && rn.item.status === 'WAITING_APPROVAL' && rn.item.risk_level === 'HIGH' && rn.item.needs_decision === true, '영상 렌더는 항상 승인 대기(HIGH) — 자동 승인 없음', rn);
  ok(rn.item.auto_approved !== true && /영상 렌더/.test(String(rn.note)), '자동 승인이 아니고 안내가 영상 렌더라고 말한다', rn.note);
  const rnRow = qrows().find(x => x[0] === rn.item.id);
  ok(col(rnRow, 'type') === 'content_render' && col(rnRow, 'approval_by') === '' && col(rnRow, 'approval_expires_at'), '시트에 content_render · 승인자 비어 있음 · 15분 기한');
  ok(JSON.parse(String(col(rnRow, 'payload'))).inputs.length === 2 && col(rnRow, 'approval_hash') === hashOf(JSON.parse(String(col(rnRow, 'payload')))), 'payload 에 파일 이름만 담기고 승인 해시가 묶인다');
  ok(post({action: 'queue_enqueue', key: K3, type: 'content_render', payload: rp}).ok === true, '작업 위치 없이도 접수된다(워크스페이스 불필요)');
  const badRender = patch => post({action: 'queue_enqueue', key: K3, type: 'content_render', workspace: 'content-hub', payload: Object.assign({}, rp, patch)});
  ok(badRender({content_id: '../x'}).code === 'bad_request' && badRender({content_id: 'a b'}).code === 'bad_request', 'content_id 에 경로·공백 금지');
  ok(badRender({brand: 'x'}).code === 'bad_request', 'brand 는 두 트랙만');
  ok(badRender({inputs: []}).code === 'bad_request' && badRender({inputs: ['a.txt']}).code === 'bad_request' && badRender({inputs: ['../a.mp4']}).code === 'bad_request' && badRender({inputs: ['x/a.mp4']}).code === 'bad_request' && badRender({inputs: ['-rf.mp4']}).code === 'bad_request', 'inputs: 빈 목록·비영상·경로·선행 - 거절');
  ok(badRender({inputs: ['a.mp4', 'A.MP4']}).code === 'bad_request' && badRender({inputs: Array(9).fill(0).map((_, i) => 'f' + i + '.mp4')}).code === 'bad_request', 'inputs: 중복·9개 거절');
  ok(badRender({profile: 'x'}).code === 'bad_request' && badRender({crop_x: 2}).code === 'bad_request', 'profile·crop_x 범위');
  ok(post({action: 'queue_enqueue', key: K3, type: 'content_render', workspace: 'nope-ws', payload: rp}).code === 'workspace', '모르는 작업 위치는 거절');

  // ⑤-2b 컷(잘라낼 구간) — 2026-11-20: 큐가 payload 를 고정 키로 다시 만들어서 cuts 가 조용히 사라지던 문제
  const one = {content_id: 'C-002', brand: 'ppiyak_kimmary', inputs: ['a.mp4'], profile: 'captions'};
  const cutPost = (p, cuts) => post({action: 'queue_enqueue', key: K3, type: 'content_render', workspace: 'content-hub', payload: Object.assign({}, p, {cuts: cuts})});
  const rc = cutPost(one, [[1.234, 2.5], [4, 5]]);
  const rcRow = qrows().find(x => x[0] === (rc.item && rc.item.id));
  const rcPayload = rcRow ? JSON.parse(String(col(rcRow, 'payload'))) : {};
  ok(rc.ok === true && JSON.stringify(rcPayload.cuts) === JSON.stringify([[1.23, 2.5], [4, 5]]), '컷이 큐에 저장된 payload 까지 살아서 간다(소수 2자리)', rcPayload);
  ok(col(rcRow, 'approval_hash') === hashOf(rcPayload), '승인 해시가 컷까지 묶는다');
  const noCut = post({action: 'queue_enqueue', key: K3, type: 'content_render', workspace: 'content-hub', payload: Object.assign({}, one, {content_id: 'C-003'})});
  const noCutRow = qrows().find(x => x[0] === (noCut.item && noCut.item.id));
  ok(noCut.ok === true && !('cuts' in JSON.parse(String(col(noCutRow, 'payload')))), '컷이 없으면 payload 에 cuts 키를 만들지 않는다');
  const two = Object.assign({}, one, {content_id: 'C-004', inputs: ['a.mp4', 'b.mp4']});
  const rc2 = cutPost(two, [[1, 2, 1]]);
  ok(rc2.ok === true && JSON.stringify(JSON.parse(String(col(qrows().find(x => x[0] === rc2.item.id), 'payload'))).cuts) === JSON.stringify([[1, 2, 1]]), '영상이 둘이면 [from,to,파일번호]');
  ok(cutPost(two, [[1, 2]]).code === 'bad_request' && cutPost(two, [[1, 2, 5]]).code === 'bad_request', '영상이 둘인데 파일 번호가 없거나 범위 밖이면 거절');
  ok(cutPost(one, [[2, 1]]).code === 'bad_request' && cutPost(one, [[-1, 1]]).code === 'bad_request' && cutPost(one, [['a', 3]]).code === 'bad_request' && cutPost(one, 'x').code === 'bad_request' && cutPost(one, [[0, 4000]]).code === 'bad_request' && cutPost(one, [[1.001, 1.004]]).code === 'bad_request', '컷 값 검사: 역순·음수·숫자 아님·배열 아님·1시간 초과·반올림 0초');
  ok(cutPost(one, Array.from({length: 151}, (_, i) => [i * 2, i * 2 + 1])).code === 'bad_request', '컷 151개는 거절');
  const many = cutPost(Object.assign({}, two, {content_id: 'C'.repeat(40)}), Array.from({length: 150}, (_, i) => [1000 + i * 2.5, 1001.5 + i * 2.5, 1]));
  ok(many.ok === true, '컷 150개(최악 길이)도 큐 payload 한도 안에서 접수된다', many);

  // ⑤-2c 채널 템플릿 — 2026-11-21: 큐가 payload 를 고정 키로 다시 만들어 template·title·badge·hook·hook_pos·hook_hold 가 조용히 사라지던 문제
  const tplPost = (extra) => post({action: 'queue_enqueue', key: K3, type: 'content_render', workspace: 'content-hub', payload: Object.assign({}, one, {content_id: 'C-010'}, extra)});
  const tplRow = (r) => qrows().find(x => x[0] === (r.item && r.item.id));
  const tplPayload = (r) => JSON.parse(String(col(tplRow(r), 'payload')));
  const t1 = tplPost({template: 'daejeon_youth', title: '  제목  두 줄  ', badge: '지역 · 카테고리', hook: '핵심 키워드', hook_pos: 'center', hook_hold: 2.4});
  const p1 = t1.ok ? tplPayload(t1) : {};
  ok(t1.ok === true && p1.template === 'daejeon_youth' && p1.title === '제목 두 줄' && p1.badge === '지역 · 카테고리' && p1.hook === '핵심 키워드', '템플릿 6개 키가 큐에 저장된 payload 까지 살아서 간다(공백 정리)', p1);
  ok(p1.hook_pos === 'center' && p1.hook_hold === 2.4, '훅 위치·유지시간도 payload 까지 간다', p1);
  ok(col(tplRow(t1), 'approval_hash') === hashOf(p1), '승인 해시가 템플릿까지 묶는다');
  const t2 = tplPost({template: 'DAEJEON_YOUTH', hook_pos: 'TOP', hook_hold: 2.46});
  const p2 = t2.ok ? tplPayload(t2) : {};
  ok(t2.ok === true && p2.template === 'daejeon_youth' && p2.hook_pos === 'top' && p2.hook_hold === 2.5, '템플릿·훅 위치는 소문자로, 유지시간은 0.1초 단위 반올림');
  const t3 = tplPost({title: '가'.repeat(60), badge: '나'.repeat(30), hook: '다'.repeat(30)});
  const p3 = t3.ok ? tplPayload(t3) : {};
  ok(t3.ok === true && p3.title.length === 40 && p3.badge.length === 14 && p3.hook.length === 16 && !('template' in p3), '제목 40 · 뱃지 14 · 훅 16자로 자르고, template 이 없으면 키를 만들지 않는다');
  const n1 = tplPost({content_id: 'C-011'});
  ok(n1.ok === true && !('template' in tplPayload(n1)) && !('hook_pos' in tplPayload(n1)), '템플릿을 안 보내면 payload 에 템플릿 키를 만들지 않는다');
  const t4 = tplPost({content_id: 'C-012', template: 'none', title: '제목', hook: '훅', hook_pos: 'center', hook_hold: 3});
  const p4 = t4.ok ? tplPayload(t4) : {};
  ok(t4.ok === true && p4.template === 'none' && p4.title === '제목' && p4.hook === '훅' && !('hook_pos' in p4) && !('hook_hold' in p4), "template 'none' 이면 훅 위치·유지시간은 버리고 나머지는 싣는다", p4);
  const t5 = tplPost({content_id: 'C-013', template: 'ppiyak_kimmary', hook_pos: 'top', hook_hold: 2});
  ok(t5.ok === true && !('hook_pos' in tplPayload(t5)) && !('hook_hold' in tplPayload(t5)), 'ppiyak_kimmary 도 훅 없는 템플릿이라 위치·유지시간을 버린다');
  ok(tplPost({content_id: 'C-014', template: 'x'}).code === 'bad_request', '모르는 template 은 거절');
  ok(tplPost({content_id: 'C-015', hook_pos: 'left'}).code === 'bad_request', 'hook_pos 는 center·top 만');
  ok(tplPost({content_id: 'C-016', hook_hold: 0.9}).code === 'bad_request' && tplPost({content_id: 'C-017', hook_hold: 4.1}).code === 'bad_request' && tplPost({content_id: 'C-018', hook_hold: 'x'}).code === 'bad_request', 'hook_hold 는 1.0~4.0초 숫자만');
  ok(tplPost({content_id: 'C-019', title: 5}).code === 'bad_request' && tplPost({content_id: 'C-020', hook: ['x']}).code === 'bad_request', '제목·뱃지·훅이 문자열이 아니면 거절');

  // ⑤-2d 무음 보조 글자·아웃트로·첫 프레임 잠금 — 2026-11-21: 같은 이유로 hook_sub·outro·frame_lock 3키가 포털 큐에서 잘리던 문제
  const t6 = tplPost({content_id: 'C-021', template: 'daejeon_youth', hook: '이 가격 실화냐?', hook_sub: '  끝까지 보세요 진짜로  ', outro: '다음 코스는? 구독' + 'O'.repeat(30)});
  const p6 = t6.ok ? tplPayload(t6) : {};
  ok(t6.ok === true && p6.hook_sub === '끝까지 보세' && p6.outro.length === 24, '무음 보조 글자 6자·아웃트로 24자로 다듬어 payload 까지 싣는다', p6);
  const t7 = tplPost({content_id: 'C-022', template: 'none', hook_sub: '끝까지', outro: '다음 코스는?'});
  const p7 = t7.ok ? tplPayload(t7) : {};
  ok(t7.ok === true && p7.hook_sub === '끝까지' && p7.outro === '다음 코스는?', '훅 없는 템플릿(none)이어도 보조 글자·아웃트로는 버리지 않는다(허브 계약 그대로)');
  ok(tplPost({content_id: 'C-023', hook_sub: 5}).code === 'bad_request' && tplPost({content_id: 'C-024', outro: ['x']}).code === 'bad_request', '보조 글자·아웃트로가 문자열이 아니면 거절');
  const f1 = tplPost({content_id: 'C-030', frame_lock: true, frame_lock_image: 'mary_front.jpg', frame_lock_seconds: 0.045});
  const f1p = f1.ok ? tplPayload(f1) : {};
  ok(f1.ok === true && f1p.frame_lock === true && f1p.frame_lock_image === 'mary_front.jpg' && f1p.frame_lock_seconds === 0.05, '첫 프레임 잠금 3키가 payload 까지 간다(길이는 소수 2자리)', f1p);
  ok(col(tplRow(f1), 'approval_hash') === hashOf(f1p), '승인 해시가 첫 프레임 잠금까지 묶는다');
  const f2 = tplPost({content_id: 'C-031', frame_lock: false, frame_lock_image: 'mary.jpg', frame_lock_seconds: 0.2});
  const f2p = f2.ok ? tplPayload(f2) : {};
  ok(f2.ok === true && !('frame_lock' in f2p) && !('frame_lock_image' in f2p) && !('frame_lock_seconds' in f2p), '잠금을 끄면 사진·길이를 조용히 버린다(숨은 동작 없음)', f2p);
  const f3 = tplPost({content_id: 'C-032', frame_lock: true});
  const f3p = f3.ok ? tplPayload(f3) : {};
  ok(f3.ok === true && f3p.frame_lock === true && !('frame_lock_image' in f3p) && !('frame_lock_seconds' in f3p), '잠금만 켜고 사진을 안 보내면 잇기만 한다(사진·길이 키 없음)', f3p);
  ok(tplPost({content_id: 'C-033', frame_lock: 'true'}).code === 'bad_request' && tplPost({content_id: 'C-034', frame_lock: 1}).code === 'bad_request', 'frame_lock 은 true·false 만');
  ok(tplPost({content_id: 'C-035', frame_lock: true, frame_lock_image: '../m.jpg'}).code === 'bad_request' && tplPost({content_id: 'C-036', frame_lock: true, frame_lock_image: 'inbox/m.jpg'}).code === 'bad_request' && tplPost({content_id: 'C-037', frame_lock: true, frame_lock_image: 'm.gif'}).code === 'bad_request' && tplPost({content_id: 'C-038', frame_lock: true, frame_lock_image: 'm.mp4'}).code === 'bad_request', '기준 사진은 jpg·png·webp 파일 이름만(경로·다른 확장자 거절)');
  ok(tplPost({content_id: 'C-039', frame_lock: true, frame_lock_seconds: 0.01}).code === 'bad_request' && tplPost({content_id: 'C-040', frame_lock: true, frame_lock_seconds: 0.6}).code === 'bad_request' && tplPost({content_id: 'C-041', frame_lock: true, frame_lock_seconds: 'x'}).code === 'bad_request', '잠금 길이는 0.02~0.5초 숫자만');

  // ⑤-2e 자동 줄·모션 — 2026-11-21: motion·motion_quality 2키가 포털 큐에서 잘리던 문제
  const m1 = tplPost({content_id: 'C-042', motion: 'none', motion_quality: 'high'});
  const m1p = m1.ok ? tplPayload(m1) : {};
  ok(m1.ok === true && m1p.motion === 'none' && m1p.motion_quality === 'high', 'motion·motion_quality 2키가 payload 까지 간다', m1p);
  ok(col(tplRow(m1), 'approval_hash') === hashOf(m1p), '승인 해시가 모션까지 묶는다');
  ok(['auto', 'dynamic', 'calm'].every(m => { const r = tplPost({content_id: 'C-043', motion: m}); return r.ok === true && tplPayload(r).motion === m; }), 'auto·dynamic·calm 도 그대로');
  const mn = tplPost({content_id: 'C-044'});
  ok(mn.ok === true && !('motion' in tplPayload(mn)) && !('motion_quality' in tplPayload(mn)), '안보내면 키를 만들지 않는다(노트북이 auto 로 돈다)');
  ok(tplPost({content_id: 'C-045', motion: 'wobble'}).code === 'bad_request' && tplPost({content_id: 'C-046', motion_quality: '4k'}).code === 'bad_request', '모르는 motion·화질은 거절');

  // ⑤-2f 내 육성 녹음 — 2026-11-23: voice_mode·voice_file·voice_offset_ms·voice_fallback_tts 4키가 포털 큐에서 잘리지 않게
  const v1 = tplPost({content_id: 'C-050', voice_mode: 'human', voice_file: 'C-050_voice.m4a', voice_offset_ms: 1200, voice_fallback_tts: true});
  const v1p = v1.ok ? tplPayload(v1) : {};
  ok(v1.ok === true && v1p.voice_mode === 'human' && v1p.voice_file === 'C-050_voice.m4a' && v1p.voice_offset_ms === 1200 && v1p.voice_fallback_tts === true, '육성 녹음 4키가 payload 까지 간다', v1p);
  ok(col(tplRow(v1), 'approval_hash') === hashOf(v1p), '승인 해시가 육성 녹음까지 묶는다');
  const v2 = tplPost({content_id: 'C-051', voice_mode: 'TTS'});
  ok(v2.ok === true && tplPayload(v2).voice_mode === 'tts' && !('voice_file' in tplPayload(v2)), 'tts 는 소문자로 싣고 파일 키는 만들지 않는다');
  const v3 = tplPost({content_id: 'C-052'});
  ok(v3.ok === true && !('voice_mode' in tplPayload(v3)) && !('voice_file' in tplPayload(v3)), '안보내면 키를 만들지 않는다(구버전 오더 그대로)');
  const v4 = tplPost({content_id: 'C-053', voice_mode: 'human', voice_file: 'my_voice.mp3'});
  ok(v4.ok === true && tplPayload(v4).voice_file === 'my_voice.mp3', 'mp3 이름도 받는다');
  ok(tplPost({content_id: 'C-054', voice_mode: 'ai'}).code === 'bad_request' && tplPost({content_id: 'C-055', voice_mode: 'human'}).code === 'bad_request' && tplPost({content_id: 'C-056', voice_mode: 'human', voice_file: '../v.m4a'}).code === 'bad_request' && tplPost({content_id: 'C-057', voice_mode: 'human', voice_file: 'inbox/v.m4a'}).code === 'bad_request' && tplPost({content_id: 'C-058', voice_mode: 'human', voice_file: 'v.aac'}).code === 'bad_request', '모르는 방식·파일 없음·경로·다른 확장자는 거절');
  ok(tplPost({content_id: 'C-059', voice_mode: 'human', voice_file: 'v.m4a', voice_offset_ms: 3001}).code === 'bad_request' && tplPost({content_id: 'C-060', voice_mode: 'human', voice_file: 'v.m4a', voice_offset_ms: 1.5}).code === 'bad_request' && tplPost({content_id: 'C-061', voice_mode: 'human', voice_file: 'v.m4a', voice_fallback_tts: 'yes'}).code === 'bad_request', 'offset 은 ±3000 정수 · fallback 은 true/false 만');

  // ⑤-2c 영상 렌더 2·3단계(stage) — 2026-11-20: 자막 초안·마무리는 원본 이름이 없고 옵션만 통과한다
  const stPost = patch => post({action: 'queue_enqueue', key: K3, type: 'content_render', workspace: 'content-hub', payload: Object.assign({content_id: 'C-010', brand: 'ppiyak_kimmary'}, patch)});
  const payloadOf = r => JSON.parse(String(col(qrows().find(x => x[0] === (r.item && r.item.id)), 'payload')));
  const tr = stPost({stage: 'transcribe', inputs: ['a.mp4'], junk: 1});
  ok(tr.ok === true && tr.item.status === 'WAITING_APPROVAL' && tr.item.risk_level === 'HIGH', '자막 초안 오더도 항상 승인 대기(HIGH)', tr);
  ok(JSON.stringify(payloadOf(tr)) === JSON.stringify({content_id: 'C-010', brand: 'ppiyak_kimmary', stage: 'transcribe'}), '자막 초안 payload 는 content_id·brand·stage 뿐(원본 이름·모르는 필드는 버린다)', payloadOf(tr));
  const fn = stPost({stage: 'finish', burn: true, ai_notice: true, bgm: {name: '잔잔한 곡.mp3', volume_db: -22}, cover: {t: 2.345}, evil: 'x'});
  ok(fn.ok === true && JSON.stringify(payloadOf(fn)) === JSON.stringify({content_id: 'C-010', brand: 'ppiyak_kimmary', stage: 'finish', burn: true, ai_notice: true, bgm: {name: '잔잔한 곡.mp3', volume_db: -22}, cover: {t: 2.35}}), '마무리 payload: 옵션이 큐 payload 까지 살아서 간다', payloadOf(fn));
  ok(JSON.stringify(payloadOf(stPost({stage: 'finish'}))) === JSON.stringify({content_id: 'C-010', brand: 'ppiyak_kimmary', stage: 'finish', burn: true, ai_notice: false}), '마무리 기본값: 자막 굽기 켬 · AI 안내 끔');
  const fnRow = qrows().find(x => x[0] === fn.item.id);
  ok(col(fnRow, 'approval_hash') === hashOf(payloadOf(fn)), '승인 해시가 단계 옵션까지 묶는다');
  ok(stPost({stage: 'hack'}).code === 'bad_request' && stPost({stage: 'finish', bgm: {name: '../x.mp3'}}).code === 'bad_request' && stPost({stage: 'finish', bgm: {name: 'x.exe'}}).code === 'bad_request' && stPost({stage: 'finish', bgm: {name: 'x.mp3', volume_db: 3}}).code === 'bad_request' && stPost({stage: 'finish', cover: {t: 5000}}).code === 'bad_request' && stPost({stage: 'finish', cover: {t: 'a'}}).code === 'bad_request' && stPost({stage: 'transcribe', content_id: '../x'}).code === 'bad_request' && stPost({stage: 'transcribe', brand: 'x'}).code === 'bad_request', '단계 값 검사: 모르는 stage·BGM 경로·확장자·볼륨·커버 시각·content_id·brand');
  ok(post({action: 'queue_enqueue', key: K3, type: 'content_render', workspace: 'content-hub', payload: {content_id: 'C-011', brand: 'ppiyak_kimmary'}}).code === 'bad_request', 'stage 도 inputs 도 없으면 거절(옛 모양 그대로)');

  // ⑤-2d 완제품 옵션 — 2026-11-20: 허브가 보낸 fit·자막·내레이션이 큐 payload 까지 살아서 간다(이 큐가 고정 키로 다시 만들어서 조용히 사라지던 문제)
  const fp = patch => post({action: 'queue_enqueue', key: K3, type: 'content_render', workspace: 'content-hub', payload: Object.assign({content_id: 'C-020', brand: 'daejeon_youth', inputs: ['a.mp4'], profile: 'captions'}, patch)});
  const fpay = r => JSON.parse(String(col(qrows().find(x => x[0] === (r.item && r.item.id)), 'payload')));
  const fullOpt = fp({fit: 'BLUR', captions: [[1, 2.5, '와 오토바이 대박'], {start: 3, end: 4, text: '세 대가 돌아가요'}], narration: [[1, 2.5, '와 대박이에요!!', 'hype']], narrate: true, burn_subtitles: false, sub_style: 'shorts', payload_source: 'inline', voice: 'ko-KR-SunHiNeural', junk: 1});
  const fpd = fpay(fullOpt);
  ok(fullOpt.ok === true && fpd.fit === 'blur' && JSON.stringify(fpd.captions) === JSON.stringify([[1, 2.5, '와 오토바이 대박'], [3, 4, '세 대가 돌아가요']]) && JSON.stringify(fpd.narration) === JSON.stringify([[1, 2.5, '와 대박이에요!!', 'hype']]) && fpd.narrate === true && fpd.burn_subtitles === false && fpd.sub_style === 'shorts' && fpd.voice === 'ko-KR-SunHiNeural' && fpd.junk === undefined, '완제품 옵션이 큐 payload 까지 살아서 간다', fpd);
  ok(fpay(fp({payload_source: 'drive'})).payload_source === 'drive' && fpay(fp({})).payload_source === undefined && fpay(fp({sub_style: 'auto'})).sub_style === undefined && fpay(fp({})).fit === undefined, 'drive 는 싣고, 기본값(inline·auto·fit 없음)은 키를 만들지 않는다');
  ok(fp({fit: 'zoom'}).code === 'bad_request' && fp({sub_style: 'big'}).code === 'bad_request' && fp({payload_source: 'ftp'}).code === 'bad_request' && fp({voice: 'x'}).code === 'bad_request' && fp({narrate: 'yes'}).code === 'bad_request' && fp({burn_subtitles: 'no'}).code === 'bad_request', '옵션 값 검사: fit·sub_style·payload_source·voice·narrate·burn_subtitles');
  ok(fp({captions: 'x'}).code === 'bad_request' && fp({captions: [[2, 1, '역순']]}).code === 'bad_request' && fp({captions: [[1, 2, '  ']]}).code === 'bad_request' && fp({captions: [[1, 2, 'a'.repeat(201)]]}).code === 'bad_request' && fp({narration: [[1, 2, '문장', 'angry']]}).code === 'bad_request' && fp({captions: Array.from({length: 81}, (_, i) => [i, i + 0.5, '큐'])}).code === 'bad_request', '큐 값 검사: 모양·시간·빈 문장·200자·톤·80큐');

  // ⑤-2e 템포(pace)·자막 비트 — 2026-11-23: 이 큐가 payload 를 고정 키로 다시 만들어 pace·beat 가 조용히 사라지던 문제
  const pfast = fp({pace: ' FAST ', blur_darken: -0.06, blur_radius: 12, captions: [[0, 2, '훅', 'hook'], [2, 4, '결론', 'payoff']]});
  const pfd = fpay(pfast);
  ok(pfast.ok === true && pfd.pace === 'fast' && pfd.blur_darken === -0.06 && pfd.blur_radius === 12, '템포·블러 여백이 큐 payload 까지 살아서 간다', pfd);
  ok(JSON.stringify(pfd.captions) === JSON.stringify([[0, 2, '훅', 'hook'], [2, 4, '결론', 'payoff']]), '자막 4번째 스토리 비트가 살아서 간다', pfd.captions);
  ok(!('pace' in fpay(fp({pace: 'standard'}))) && !('blur_darken' in fpay(fp({}))), 'standard·빈 값은 키를 만들지 않는다(기본값)');
  ok(fp({pace: 'turbo'}).code === 'bad_request' && fp({blur_darken: -0.9}).code === 'bad_request' && fp({blur_darken: 0.2}).code === 'bad_request' && fp({blur_radius: 99}).code === 'bad_request', '템포·블러 범위 검사');
  ok(JSON.stringify(fpay(fp({captions: [[0, 2, '장면', 'scene']]})).captions) === JSON.stringify([[0, 2, '장면']]), '모르는 비트는 버리고 문장만 보낸다(구버전 허브 호환)');

  // ⑤-2g 🎵 뮤직비디오(MV) 모드 — 2026-11-27: 이 큐가 payload 를 고정 키(inputs 1~8)로 다시 만들어
  //  MV 오더(mode·images·mv)가 거절되거나 조용히 사라지던 문제. 계약은 허브 gas/Orders.gs hubRenderMvPayload_ ·
  //  노트북 lib/render.js validateMv 와 같다(사진만이면 3장 이상 · 영상 컷이 있으면 사진 0장부터 · 둘 다 없으면 거절).
  const mvPost = patch => post({action: 'queue_enqueue', key: K3, type: 'content_render', workspace: 'content-hub', payload: Object.assign({content_id: 'C-100', brand: 'daejeon_youth', mode: 'mv'}, patch)});
  const mvPay = r => JSON.parse(String(col(qrows().find(x => x[0] === (r.item && r.item.id)), 'payload')));
  const mvOk = r => r.ok === true;

  // ① 사진 전용 — 사진 3장이면 영상 컷 없이 된다
  const mvA = mvPost({images: ['사진 01.jpg', '사진 02.png', '사진 03.webp'], mv: {audio: '내 노래.mp3'}});
  const mvAp = mvOk(mvA) ? mvPay(mvA) : {};
  ok(mvA.ok === true && mvA.item.status === 'WAITING_APPROVAL' && mvA.item.risk_level === 'HIGH', 'MV 오더도 늘 승인 대기(HIGH)', mvA);
  ok(mvAp.mode === 'mv' && mvAp.profile === 'captions' && JSON.stringify(mvAp.images) === JSON.stringify(['사진 01.jpg', '사진 02.png', '사진 03.webp']) && mvAp.inputs === undefined, '사진 전용 MV: mode·images 가 payload 까지 가고 inputs 키는 만들지 않는다', mvAp);
  ok(mvAp.mv.audio === '내 노래.mp3' && mvAp.mv.density === 'normal_4beat' && mvAp.mv.effects === 'pulse' && mvAp.mv.mood === 'pop' && mvAp.mv.lyric_mode === 'mine' && mvAp.mv.bpm_hint === 0 && mvAp.mv.length_sec === 0 && mvAp.mv.lines === 0, 'mv 기본값이 허브 계약대로 채워진다(보내지 않은 칸도 노트북이 읽는 모양 그대로)', mvAp.mv);
  ok(col(qrows().find(x => x[0] === mvA.item.id), 'approval_hash') === hashOf(mvAp), '승인 해시가 MV payload 까지 묶는다');

  // ② 사진 + 영상 컷 혼합 — 영상 컷이 있으면 사진 0장부터
  const mvB = mvPost({images: ['표지.jpg'], inputs: ['첫 컷.mp4', 'b.mov'],
    mv: {audio: 'song.m4a', density: 'FAST_2BEAT', bpm_hint: 128.46, length_sec: 61.7, effects: 'none', mood: 'rock', lyric_mode: 'mine', lyrics: '첫 줄\r\n둘째 줄\n\n  셋째 줄  '}});
  const mvBp = mvOk(mvB) ? mvPay(mvB) : {mv: {}};
  ok(mvB.ok === true && mvBp.images.length === 1 && JSON.stringify(mvBp.inputs) === JSON.stringify(['첫 컷.mp4', 'b.mov']), '사진 1장 + 영상 컷 2개를 함께 싣는다(예전엔 MV 자체가 거절됨)', mvBp);
  ok(mvBp.mv.density === 'fast_2beat' && mvBp.mv.bpm_hint === 128.5 && mvBp.mv.length_sec === 62 && mvBp.mv.effects === 'none' && mvBp.mv.mood === 'rock', 'mv 값은 소문자·BPM 0.1 단위·길이 정수 초로 다듬어 싣는다', mvBp.mv);
  ok(mvBp.mv.lyrics === '첫 줄\n둘째 줄\n\n  셋째 줄' && mvBp.mv.lines === 3, '가사는 줄바꿈만 남기고 다듬고, 줄 수(lines)를 함께 싣는다', mvBp.mv);
  ok(col(qrows().find(x => x[0] === mvB.item.id), 'approval_hash') === hashOf(mvBp), '승인 해시가 영상 컷·가사까지 묶는다');

  // ③ 영상 컷 단독(사진 0장) — 앨범아트 없이 컷으로만
  const mvC = mvPost({inputs: ['a.mp4'], mv: {audio: 'song.wav', lyric_mode: 'none', lyrics: '가사'}});
  const mvCp = mvOk(mvC) ? mvPay(mvC) : {mv: {}};
  ok(mvC.ok === true && Array.isArray(mvCp.images) && mvCp.images.length === 0 && mvCp.inputs.length === 1, '영상 컷 단독(사진 0장)도 접수된다 — images 는 빈 배열', mvCp);
  ok(mvCp.mv.lyric_mode === 'none' && mvCp.mv.lyrics === '' && mvCp.mv.lines === 0, 'lyric_mode=none 이면 가사를 비운다(허브·노트북과 같은 뜻)');

  // ④ 거절 케이스 — 둘 다 부족·음원 없음·값 오류
  ok(mvPost({images: ['a.jpg', 'b.jpg'], mv: {audio: 's.mp3'}}).code === 'bad_request', '사진 2장만(영상 컷 없음)은 거절 — 3장 이상 필요');
  ok(mvPost({mv: {audio: 's.mp3'}}).code === 'bad_request' && mvPost({images: [], inputs: [], mv: {audio: 's.mp3'}}).code === 'bad_request', '사진도 영상 컷도 없으면 거절');
  ok(mvPost({mode: 'pic', inputs: ['a.mp4']}).code === 'bad_request', '모르는 mode 는 거절(조용히 일반 영상으로 보내지 않는다)');
  ok(mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg']}).code === 'bad_request' && mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: '내 노래.mp3'}).code === 'bad_request', '음원(mv.audio)이 없으면 거절');
  ok(mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: '../s.mp3'}}).code === 'bad_request' && mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: 's.aac'}}).code === 'bad_request' && mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: './s.mp3'}}).code === 'bad_request', '음원은 mp3·m4a·wav 파일 이름만(경로·다른 확장자 거절)');
  ok(mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: 's.mp3', density: 'x'}}).code === 'bad_request' && mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: 's.mp3', effects: 'shake'}}).code === 'bad_request' && mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: 's.mp3', mood: 'trot'}}).code === 'bad_request' && mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: 's.mp3', lyric_mode: 'auto'}}).code === 'bad_request', 'density·effects·mood·lyric_mode 는 정해진 값만');
  ok(mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: 's.mp3', bpm_hint: 301}}).code === 'bad_request' && mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: 's.mp3', bpm_hint: 'x'}}).code === 'bad_request' && mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: 's.mp3', length_sec: 601}}).code === 'bad_request', '박자 힌트 0~300 · 길이 0~600초');
  ok(mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: 's.mp3', lyrics: '가'.repeat(8001)}}).code === 'bad_request', '가사는 8,000자까지');
  ok(mvPost({images: Array.from({length: 26}, (_, i) => 'p' + i + '.jpg'), mv: {audio: 's.mp3'}}).code === 'bad_request', '사진은 25장까지');
  ok(mvPost({inputs: Array.from({length: 9}, (_, i) => 'v' + i + '.mp4'), mv: {audio: 's.mp3'}}).code === 'bad_request', '영상 컷은 8개까지');
  ok(mvPost({images: ['a.jpg', 'A.JPG', 'c.jpg'], mv: {audio: 's.mp3'}}).code === 'bad_request' && mvPost({inputs: ['a.mp4', 'A.MP4'], mv: {audio: 's.mp3'}}).code === 'bad_request', '같은 사진·같은 영상이 두 번이면 거절(대소문자 무시 — 노트북도 막는다)');
  ok(mvPost({images: ['a.gif', 'b.jpg', 'c.jpg'], mv: {audio: 's.mp3'}}).code === 'bad_request' && mvPost({images: ['../a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: 's.mp3'}}).code === 'bad_request' && mvPost({images: ['inbox/a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: 's.mp3'}}).code === 'bad_request' && mvPost({inputs: ['a.txt'], mv: {audio: 's.mp3'}}).code === 'bad_request', '사진·영상 컷은 이름만(경로·다른 확장자 거절)');
  ok(mvPost({images: 'a.jpg', mv: {audio: 's.mp3'}}).code === 'bad_request' && mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: 's.mp3'}, payload_source: 'ftp'}).code === 'bad_request', 'images 가 배열이 아니거나 모르는 payload_source 는 거절');

  // ⑤ 긴 가사 — 큐 4,000자 한도를 넘기지 않게 가사만 빼고 payload_source:drive(허브와 같은 규칙)
  const longLy = Array.from({length: 60}, (_, i) => '가' + '나'.repeat(43) + ' ' + i).join('\n');
  const mvD = mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: 's.mp3', lyrics: longLy}});
  const mvDp = mvOk(mvD) ? mvPay(mvD) : {mv: {}};
  ok(longLy.length > 2000 && longLy.length < 8000, '시험용 가사는 2,000~8,000자 사이', longLy.length);
  ok(mvD.ok === true && mvDp.mv.lyrics === undefined && mvDp.mv.lines === 60 && mvDp.payload_source === 'drive', '2,000자가 넘는 가사는 큐에 싣지 않고 payload_source:drive 로 넘긴다(노트북이 카드에서 읽는다)', mvDp);
  const mvE = mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: 's.mp3'}, payload_source: 'drive'});
  ok(mvE.ok === true && mvPay(mvE).payload_source === 'drive', '허브가 정한 payload_source:drive 를 그대로 넘긴다');
  ok(mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: 's.mp3'}, payload_source: 'inline'}).ok === true && mvPay(mvPost({images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: 's.mp3'}, payload_source: 'inline'})).payload_source === undefined, 'inline 은 기본값이라 키를 만들지 않는다');
  ok(mvPost({mode: 'MV', images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: {audio: 's.mp3'}}).ok === true, '대문자 MV 도 받아준다');

  // ⑥ 일반 모드 회귀 — mode 가 없으면 예전 그대로(inputs 1~8 필수 · images·mode 키 없음)
  const plainMv = post({action: 'queue_enqueue', key: K3, type: 'content_render', workspace: 'content-hub', payload: {content_id: 'C-110', brand: 'daejeon_youth', inputs: ['a.mp4'], images: ['p.jpg']}});
  const plainP = mvOk(plainMv) ? mvPay(plainMv) : {};
  ok(plainMv.ok === true && plainP.mode === undefined && plainP.images === undefined && JSON.stringify(plainP.inputs) === JSON.stringify(['a.mp4']), 'mode 없는 일반 오더는 예전 그대로 — images·mode 키를 만들지 않는다', plainP);
  ok(post({action: 'queue_enqueue', key: K3, type: 'content_render', workspace: 'content-hub', payload: {content_id: 'C-111', brand: 'daejeon_youth', images: ['a.jpg', 'b.jpg', 'c.jpg']}}).code === 'bad_request', 'mode 없이 사진만 보내면 예전처럼 거절(일반 영상 규칙 그대로)');

  // ⑦ 왕복 항등 — 허브 hubRenderMvPayload_ 가 내놓은 payload 를 그대로 다시 넣어도 한 글자도 안 바뀌는지
  //  (키 순서까지 같다: 허브도 images 다음에 mv 를 놓고 inputs 를 마지막에 붙인다).
  const hubMv = {content_id: 'CH-20261127-ab12', brand: 'daejeon_youth', profile: 'captions', mode: 'mv',
    images: ['사진01.jpg', '사진02.jpg', '사진03.jpg'],
    mv: {audio: '내 노래.mp3', density: 'normal_4beat', bpm_hint: 128, effects: 'pulse', mood: 'pop', length_sec: 0, lyric_mode: 'mine', lines: 2, lyrics: '첫 줄\n둘째 줄'}};
  hubMv.inputs = ['첫 컷.mp4', 'b.mov'];
  const hubBack = post({action: 'queue_enqueue', key: K3, type: 'content_render', workspace: 'content-hub', payload: hubMv});
  ok(hubBack.ok === true && JSON.stringify(mvPay(hubBack)) === JSON.stringify(hubMv), '허브가 만든 MV payload(영상 컷 혼합)는 큐를 지나도 그대로 — 왕복 항등', mvPay(hubBack));
  const hubPhoto = {content_id: 'CH-20261127-cd34', brand: 'ppiyak_kimmary', profile: 'captions', mode: 'mv',
    images: ['a.jpg', 'b.jpg', 'c.jpg'],
    mv: {audio: 'song.mp3', density: 'normal_4beat', bpm_hint: 0, effects: 'pulse', mood: 'pop', length_sec: 0, lyric_mode: 'none', lines: 0, lyrics: ''}};
  const hubPhotoBack = post({action: 'queue_enqueue', key: K3, type: 'content_render', workspace: 'content-hub', payload: hubPhoto});
  ok(hubPhotoBack.ok === true && JSON.stringify(mvPay(hubPhotoBack)) === JSON.stringify(hubPhoto), '허브가 만든 사진 전용 MV payload 도 그대로(lyrics 빈 문자열·inputs 칸 없음까지 같다)', mvPay(hubPhotoBack));

  // ⑤-2 AI 엔진 — payload.engine 이 워커까지 가도록 그대로 싣는다
  const engQ = post({action: 'queue_enqueue', key: K3, type: 'claude_prompt', workspace: 'gaegyebu', payload: {prompt: '제미나이로 요약', mode: 'ask', engine: 'agy'}});
  ok(engQ.ok === true, '엔진을 붙인 오더도 접수');
  const engRow = qrows().find(x => x[0] === engQ.item.id);
  const engPayload = JSON.parse(String(col(engRow, 'payload')));
  ok(engPayload.engine === 'agy' && engPayload.prompt.indexOf('제미나이로 요약') === 0 && engPayload.mode === 'ask', 'payload 에 engine 이 실린다(예전엔 버려졌음)', engPayload);
  ok(col(engRow, 'approval_hash') === hashOf(engPayload), '승인 해시가 engine 까지 묶는다');
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
  // 2026-11-26 — '클로드: ' 접두사·160자 컷을 없앴다(대화가 잘려 저장되던 원인). 요약은 본문 그대로.
  ok(q.items[0].summary.indexOf('클로드: ') !== 0 && q.items[0].summary.indexOf('[REDACTED]') >= 0, '요약에 클로드: 접두사를 붙이지 않는다(가림은 그대로)');
  const longSummary = q.items.filter(i => i.id === longOk.item.id)[0];
  ok(longSummary && longSummary.summary.length === 2000 && !/…$/.test(longSummary.summary), '긴 오더 요약도 자르지 않는다(2,000자 그대로)');
  ok(q.pending >= 2 && q.waiting >= 1, '건수(PENDING·승인 대기)를 같이 준다');

  // ⑧ 승인 → PENDING + Audit_Log
  let dec = post({action: 'queue_decide', key: K3, id: editId, decision: 'approve'});
  ok(dec.ok === true && dec.changed === true && dec.status === 'PENDING', '승인하면 PENDING 으로 내려간다');
  const aRow = qrows().find(x => x[0] === editId);
  ok(col(aRow, 'status') === 'PENDING' && col(aRow, 'approval_by') === 'portal' && !!col(aRow, 'approval_at'), '승인자·시각 기록');
  ok(Array.isArray(audit()) && audit()[0][0] === 'at' && audit().some(a => a[1] === editId && a[5] === 'approve' && a[6] === 'portal' && a[7] === 'portal'), 'Audit_Log 에 approve/portal 기록');
  const aForEdit = (audit() || []).find(a => a[1] === editId) || [];
  ok(String(aForEdit[9]) === col(aRow, 'approval_hash'), '감사 기록에 payload 해시가 남는다');
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
  const hxRow = qrows().find(x => x[0] === hx.item.id);
  const mm2 = post({action: 'queue_decide', key: K3, id: hx.item.id, decision: 'approve',
    payload_hash: hashOf(JSON.parse(String(col(hxRow, 'payload'))))});
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

  // ⑬-3 야간 무인 하트비트(2026-11-18) — started_at·beat_at 을 같이 내려주고 정체 판단에 쓴다
  {
    const HEAD28 = HEAD.concat(['branch', 'block_reason', 'diff_summary', 'changed_files', 'started_at', 'beat_at']);
    const SHEET28 = 'SHEETidBeat28Cols001';
    const beatVals = {
      id: 'Q-20261118-130000-beat', created_at: '2026-11-18T13:00:00+09:00', source: 'pickle',
      type: 'claude_prompt', workspace: 'content-hub', payload: JSON.stringify({ prompt: '큰 작업', mode: 'edit' }),
      status: 'RUNNING', attempts: 0, claimed_at: '2026-11-18T13:00:05+09:00', claimed_by: 'notebook',
      started_at: '2026-11-18T13:00:05+09:00', beat_at: '2026-11-18T13:27:40+09:00'
    };
    const beatRow = HEAD28.map(n => (beatVals[n] === undefined ? '' : beatVals[n]));
    S.addSheet(SHEET28, { Command_Queue: [HEAD28.slice(), beatRow] });
    S.props.QUEUE_SHEET_ID = SHEET28;
    const bq = post({ action: 'queue_list', key: K3 });
    const bi = bq.items[0];
    ok(bi && bi.started_at === '2026-11-18T13:00:05+09:00' && bi.beat_at === '2026-11-18T13:27:40+09:00',
      '목록에 시작 시각과 마지막 신호를 같이 준다(포털이 경과·정체를 판단)', bi);
    ok(bi && bi.claimed_at === '2026-11-18T13:00:05+09:00', 'claimed_at 은 시작 시각으로 남녕 있다(구버전 화면 호환)');
    const bs = post({ action: 'queue_status', key: K3 });
    ok(bs && bs.queue && bs.queue.state, '상태등이 heartbeat 신호(beat_at)를 읽고 오류 없이 응답한다', bs && bs.queue);
    S.props.QUEUE_SHEET_ID = SHEET;
  }

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

console.log('9-1) 🤖 오더 프롬프트에 "셸은 없다" 자동 주입 (2026-11-19)');
{
  const K3 = S.props.SECRET_KEY;
  const before = S.books['SHEETidForTest0001']['Command_Queue'].length;
  const r = post({action:'queue_enqueue', key:K3, type:'claude_prompt', workspace:'content-hub',
    payload:{mode:'edit', prompt:'파일 하나만 고쳐라. 끝나면 npm test 로 확인해라.'}});
  ok(r.ok === true && r.item && r.item.id, 'claude_prompt 접수', r.error);
  const bk = S.books[S.props.QUEUE_SHEET_ID] || {};
  const findRow = id => {
    let found = null;
    Object.keys(bk).forEach(t => { const f = (bk[t] || []).find(x => x && x[0] === id); if (f) found = f; });
    return found;
  };
  const row = findRow(r.item.id);
  const pl = JSON.parse(row[5]);
  ok(/\[워커 규칙\]/.test(pl.prompt), '워커 규칙이 붙는다', pl.prompt.slice(-60));
  ok(pl.prompt.indexOf('파일 하나만 고쳐라') === 0, '원래 지시는 보존');
  ok(pl.worker_note === 'auto', '자동 주입 표식');
  const again = post({action:'queue_enqueue', key:K3, type:'git_pull', workspace:'gaegyebu', payload:{}});
  const grow = findRow(again.item.id) || [];
  ok(String(grow[5]).indexOf('워커 규칙') === -1, '다른 타입에는 안 붙는다');
  ok(!!grow.length, '두 번째 오더도 접수됐다');

  // 2026-11-25 — 대화(kind=chat)는 답장이라 셸 규칙이 필요 없다. 말풍선·요약에 규칙 문구가 보이면 안 된다.
  const ch = post({action:'queue_enqueue', key:K3, type:'claude_prompt', workspace:'gaegyebu',
    payload:{prompt:'자 ai 친구들 대답해봐라', mode:'ask', kind:'chat', target:'all'}});
  ok(ch.ok === true && ch.item.kind === 'chat', '대화 접수', ch.error);
  const chPl = JSON.parse(findRow(ch.item.id)[5]);
  ok(String(chPl.prompt).indexOf('워커 규칙') === -1 && !chPl.worker_note, '대화에는 워커 규칙을 붙이지 않는다', chPl.prompt);
  ok(ch.item.summary === '자 ai 친구들 대답해봐라', '대화 요약은 말 그대로(클로드: 접두사·규칙 문구 없음)', ch.item.summary);

  // 옛 줄 — 이미 규칙 문구가 붙어 저장된 대화·오더도 요약에서는 뗀다(멱등)
  const QHEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const legacy = findRow(ch.item.id).slice();
  legacy[QHEAD.indexOf('id')] = 'Q-LEGACY-NOTE-1';
  legacy[QHEAD.indexOf('payload')] = JSON.stringify({prompt: '자 ai 친구들 대답해봐라' + '\n\n[워커 규칙] 셸(Bash)은 차단되어 있다. 테스트·문법 검증은 …', mode: 'ask', kind: 'chat', worker_note: 'auto'});
  S.books[S.props.QUEUE_SHEET_ID]['Command_Queue'].push(legacy);
  const lg = post({action:'queue_list', key:K3, limit:5});
  const lgItem = lg.items.filter(x => x.id === 'Q-LEGACY-NOTE-1')[0] || {};
  ok(!!lgItem.id && String(lgItem.summary).indexOf('워커 규칙') === -1, '옛 대화 줄도 요약에 규칙 문구가 없다', lgItem.summary);
  ok(String(lgItem.summary) === '자 ai 친구들 대답해봐라', '옛 대화 요약은 말만 남는다', lgItem.summary);
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
  ok(JSON.stringify(r.beat_targets)===JSON.stringify(['direct','pc','pi1','pi2']), 'beat_targets 로 이 배포가 pc·피원(pi1)·피투(pi2) 를 아는지 알려준다');

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

console.log('14) 💬 회의실 — 발신(source)·대상(target)·대화(kind) 가 큐에 남는다');
{
  const K9 = S.props.SECRET_KEY;
  const SHEET = 'SHEETidRoomQueue001';
  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  S.addSheet(SHEET, {'Command_Queue': [HEAD.slice(0)]});
  S.props.QUEUE_SHEET_ID = SHEET;
  const qrows = () => S.books[SHEET]['Command_Queue'];
  const col = (row, n) => row[HEAD.indexOf(n)];
  const last = () => qrows()[qrows().length - 1];

  // ① 발신자 — pi1 · pi2 · 새 비서(vooy) · 이상한 값은 portal
  let r = post({action: 'queue_enqueue', key: K9, type: 'git_pull', workspace: 'gaegyebu', payload: {}, source: 'pi1'});
  ok(r.ok === true && col(last(), 'source') === 'pi1', 'source=pi1 이 시트에 그대로 남는다(피원이 낸 오더)');
  r = post({action: 'queue_enqueue', key: K9, type: 'git_pull', workspace: 'gaegyebu', payload: {}, source: 'pi2'});
  ok(col(last(), 'source') === 'pi2', 'source=pi2 도 남는다(피투)');
  r = post({action: 'queue_enqueue', key: K9, type: 'git_pull', workspace: 'gaegyebu', payload: {}, source: 'vooy'});
  ok(col(last(), 'source') === 'vooy', '새 비서(vooy)도 재배포 없이 그 이름으로 남는다');
  r = post({action: 'queue_enqueue', key: K9, type: 'git_pull', workspace: 'gaegyebu', payload: {}, source: 'BAD SPACE!'});
  ok(col(last(), 'source') === 'portal', '규칙에 안 맞는 source 는 portal 로');
  r = post({action: 'queue_enqueue', key: K9, type: 'git_pull', workspace: 'gaegyebu', payload: {}});
  ok(col(last(), 'source') === 'portal', 'source 가 없으면 portal');

  // ①' 발신자를 최상위가 아니라 payload 안에만 넣는 비서도 있다(2026-11-26) — 그때 남의 말이 '내 말(portal)'로 찍혔다
  r = post({action: 'queue_enqueue', key: K9, type: 'claude_prompt', workspace: 'gaegyebu',
    payload: {prompt: '@피원 확인', mode: 'ask', kind: 'chat', target: 'pi1', source: 'cue'}});
  ok(col(last(), 'source') === 'cue', 'payload.source 만 있어도 발신자(cue)로 남는다');
  r = post({action: 'queue_enqueue', key: K9, type: 'claude_prompt', workspace: 'gaegyebu',
    payload: {prompt: '안녕', mode: 'ask', kind: 'chat', source: 'BAD SPACE!'}});
  ok(col(last(), 'source') === 'portal', 'payload.source 가 규칙에 안 맞으면 portal');
  r = post({action: 'queue_enqueue', key: K9, type: 'git_pull', workspace: 'gaegyebu', source: 'pi1', payload: {source: 'cue'}});
  ok(col(last(), 'source') === 'pi1', '최상위 source 가 있으면 그것이 먼저(payload.source 는 fallback)');

  // ② 대화(kind=chat) + 대상(target) — 같은 claude_prompt 큐에 실린다
  r = post({action: 'queue_enqueue', key: K9, type: 'claude_prompt', workspace: 'gaegyebu', source: 'pi1',
    payload: {prompt: '@피투 이번 주 블로그 소재 뽑아줘', mode: 'ask', kind: 'chat', target: 'pi2'}});
  ok(r.ok === true && r.item.status === 'PENDING', '대화 메시지는 승인 없이 PENDING');
  ok(r.item.kind === 'chat' && r.item.target === 'pi2', 'kind=chat · target=pi2 가 목록에 돌아온다');
  ok(col(last(), 'type') === 'claude_prompt', '시트 type 은 claude_prompt 그대로(노트북 호환)');
  const pl = JSON.parse(col(last(), 'payload'));
  ok(pl.kind === 'chat' && pl.target === 'pi2' && pl.mode === 'ask' && /블로그 소재/.test(pl.prompt), 'payload 에 kind·target 이 실린다');
  r = post({action: 'queue_enqueue', key: K9, type: 'claude_prompt', workspace: 'gaegyebu',
    payload: {prompt: '보통 오더', mode: 'ask', kind: 'nope', target: 'NOPE!'}});
  ok(!r.item.kind && !r.item.target, '모르는 kind·target 은 싣지 않는다');

  // ②' target=notebook — 기본값이라며 지우면 노트북이 그 대화를 영영 집지 않는다(2026-11-27 회귀)
  //  노트북은 kind='chat' 이면 target='notebook' 인 줄만 집어 간다(hub-agent cqForNotebook_ · lib/targets.js).
  r = post({action: 'queue_enqueue', key: K9, type: 'claude_prompt', workspace: 'gaegyebu',
    payload: {prompt: '🌿어사이드 상태', mode: 'ask', kind: 'chat', target: 'notebook'}});
  ok(r.ok === true && r.item.kind === 'chat' && r.item.target === 'notebook', '@노트북 대화는 목록에도 target=notebook 으로 돌아온다');
  ok(JSON.parse(col(last(), 'payload')).target === 'notebook', 'payload 에 target:"notebook" 이 남는다(노트북이 이 값으로 집는다)');
  //  본문에 @노트북 만 적은 대화도 같은 값으로 남는다
  r = post({action: 'queue_enqueue', key: K9, type: 'claude_prompt', workspace: 'gaegyebu',
    payload: {prompt: '@노트북 오늘 일정 정리해줘', mode: 'ask', kind: 'chat'}});
  ok(JSON.parse(col(last(), 'payload')).target === 'notebook', '본문 @노트북 멘션도 target=notebook 으로 실린다');

  // ③ @멘션 필터 — 내 앞으로 온 말만
  const mine = post({action: 'queue_list', key: K9, target: 'pi2', limit: 20});
  ok(mine.items.every(x => x.target === 'pi2' || x.target === 'all'), 'target=pi2 로 부르면 내 멘션만 온다');
  ok(mine.items.length >= 1 && mine.items.some(x => /블로그 소재/.test(x.summary)), '그 메시지가 목록에 있다');
  const all = post({action: 'queue_list', key: K9, limit: 20});
  ok(all.items.length > mine.items.length, '필터 없이 부르면 전체');
  ok(all.chat === true, '이 배포가 대화(kind=chat)와 대상(target)을 안다고 알려준다');
  ok(all.source_fallback === true, '이 배포가 발신자를 payload.source 에서도 읽는다고 알려준다(배포 확인용)');

  // ④ 발신별 건수 — 화면 필터가 쓰는 source 가 목록에 실린다
  const seen = {};
  all.items.forEach(x => { seen[x.source] = (seen[x.source] || 0) + 1; });
  ok(seen.pi1 >= 1 && seen.pi2 >= 1 && seen.portal >= 1 && seen.vooy >= 1, 'source 별로 셀 수 있다(pi1·pi2·portal·vooy)');

  // ⑤ 대용량 — 매칭이 드문 target 도 행마다 qqItem_ 을 만들지 않는다 (2026-11-25 타임아웃 수정)
  {
    const mk = (id, payload, status) => {
      const row = new Array(HEAD.length).fill('');
      row[HEAD.indexOf('id')] = id;
      row[HEAD.indexOf('created_at')] = '2026-11-25T10:00:00+09:00';
      row[HEAD.indexOf('source')] = 'portal';
      row[HEAD.indexOf('type')] = 'claude_prompt';
      row[HEAD.indexOf('payload')] = payload;
      row[HEAD.indexOf('status')] = status || 'DONE';
      return row;
    };
    for (let i = 0; i < 500; i++) qrows().push(mk('Q-BULK-' + i, JSON.stringify({prompt: '잡무 ' + i, mode: 'ask'})));
    qrows().push(mk('Q-CUE-1', JSON.stringify({prompt: '부이 확인', mode: 'ask', kind: 'chat', target: 'cue'})));
    qrows().push(mk('Q-ALL-1', JSON.stringify({prompt: '전체 공지', mode: 'ask', kind: 'chat', target: 'all'})));

    const orig = S.sb.qqItem_;
    let calls = 0;
    S.sb.qqItem_ = function (r) { calls++; return orig(r); };
    let t0 = Date.now();
    const cue = post({action: 'queue_list', key: K9, target: 'cue', limit: 10});
    const msCue = Date.now() - t0, callsCue = calls;
    calls = 0; t0 = Date.now();
    const none = post({action: 'queue_list', key: K9, target: 'vooy', limit: 10});
    const msNone = Date.now() - t0, callsNone = calls;
    calls = 0; t0 = Date.now();
    const plain = post({action: 'queue_list', key: K9, limit: 10});
    const msPlain = Date.now() - t0;
    S.sb.qqItem_ = orig;

    ok(cue.ok === true && cue.items.length === 2, '500행 뒤에서도 cue·전체 멘션 2건만 온다');
    ok(cue.items.every(x => x.target === 'cue' || x.target === 'all'), 'target=cue 는 cue·all 만');
    ok(callsCue <= 5, '사전 거르기 — 매칭 행에만 qqItem_ 을 만든다(호출 ' + callsCue + '회/502행)');
    ok(none.ok === true && none.items.length === 1 && none.items[0].target === 'all', '매칭 0건이면 @전체 한 건만');
    ok(callsNone <= 2, '매칭 0건이면 qqItem_ 을 거의 만들지 않는다(호출 ' + callsNone + '회/502행)');
    ok(msCue < 2000 && msNone < 2000 && msPlain < 2000,
      '대용량에서도 2초 안에 끝난다(cue ' + msCue + 'ms · 0건 ' + msNone + 'ms · 필터없음 ' + msPlain + 'ms)');
    ok(plain.items.length === 10 && plain.items[0].id === 'Q-ALL-1', '필터 없이 부르면 최근 것부터 10건 그대로');
  }
}

console.log('15) 📊 비서 사용량 (usage_get · usage_set) 과 피원·피투 상태 비트');
{
  const KS = S.props.SECRET_KEY;
  const folder = S.ROOT.folders.filter(x => x.name === '김성래포털')[0];
  const usFile = () => folder.files.filter(x => x.name === '포털_비서사용량.json')[0];

  let r = post({action: 'usage_get', key: KS});
  ok(r.ok === true && Array.isArray(r.items) && r.items.length === 0, '처음엔 빈 장부');

  const now = new Date().toISOString();
  r = post({action: 'usage_set', key: KS, items: [{id: 'pi1', pct: 95, at: now}, {id: 'pi2', pct: 12.5, at: now}]});
  ok(r.ok === true && r.saved === 2, '남은 % 두 개를 저장');
  ok(!!usFile(), '드라이브에 포털_비서사용량.json 이 생긴다');
  r = post({action: 'usage_get', key: KS});
  const by = {}; r.items.forEach(x => { by[x.id] = x.pct; });
  ok(by.pi1 === 95 && by.pi2 === 12.5, '저장한 값이 그대로 읽힌다');

  // 더 최근 값이 이긴다(여러 기기)
  const older = new Date(Date.now() - 3600000).toISOString();
  r = post({action: 'usage_set', key: KS, items: [{id: 'pi1', pct: 50, at: older}]});
  ok(r.ok === true && post({action: 'usage_get', key: KS}).items.filter(x => x.id === 'pi1')[0].pct === 95,
    '시각(at)이 더 오래된 값은 무시한다(기기 두 대가 서로 덮지 않게)');
  const newer = new Date(Date.now() + 60000).toISOString();
  post({action: 'usage_set', key: KS, items: [{id: 'pi1', pct: 66, at: newer}]});
  ok(post({action: 'usage_get', key: KS}).items.filter(x => x.id === 'pi1')[0].pct === 66, '더 최근 값은 덮어쓴다');

  // 새 비서(vooy)도 같은 규칙이면 저장된다 — GAS 재배포 없이
  r = post({action: 'usage_set', key: KS, items: [{id: 'vooy', pct: 40, at: new Date().toISOString()}]});
  ok(r.ok === true, '추가한 비서(vooy)도 저장된다');
  ok(post({action: 'usage_get', key: KS}).items.some(x => x.id === 'vooy' && x.pct === 40), 'vooy 값이 읽힌다');

  // 잘못된 값은 거절
  ok(post({action: 'usage_set', key: KS, items: [{id: 'pi1', pct: 120}]}).ok === false, 'pct 120 은 거절');
  ok(post({action: 'usage_set', key: KS, items: [{id: 'pi1', pct: -1}]}).ok === false, 'pct -1 은 거절');
  ok(post({action: 'usage_set', key: KS, items: [{id: 'BAD ID!', pct: 10}]}).ok === false, '규칙에 안 맞는 id 는 거절');
  ok(post({action: 'usage_set', key: KS, items: []}).ok === false, '빈 items 는 거절');

  // ⑤ 피원(pi1)·피투(pi2) 상태 비트 — 저장소 파일이 없어도 지금 작업이 보인다
  r = post({action: 'agent_beat', key: KS, target: 'pi2', state: 'working', project: 'portal', task: '회의실 개편'});
  ok(r.ok === true && r.target === 'pi2', 'agent_beat target=pi2 를 받는다');
  const f2 = folder.files.filter(x => x.name === '포털_agent_pi2.json')[0];
  ok(!!f2 && JSON.parse(f2.content).agent.task === '회의실 개편', '포털_agent_pi2.json 에 따로 쌓인다');
  r = post({action: 'agent_status', key: KS});
  ok(r.pi2 && r.pi2.state === 'working' && r.pi2.project === 'portal', 'agent_status 에 pi2 블록이 붙는다');
  ok(JSON.stringify(r.beat_targets) === JSON.stringify(['direct', 'pc', 'pi1', 'pi2']), 'beat_targets 에 pi1·pi2 가 들어간다');
  r = post({action: 'agent_beat', key: KS, target: 'pi1', state: 'idle'});
  ok(post({action: 'agent_status', key: KS}).pi1.state === 'idle', '피원(pi1) 비트도 따로 남는다');
}

console.log('16) 👥 참여 비서 명부(agents_get·agent_save) · 부분 사용량 보고(usage_report) · 큐 자동 합류(sources_seen)');
{
  const KS = S.props.SECRET_KEY;
  const folder = S.ROOT.folders.filter(x => x.name === '김성래포털')[0];
  const agFile = () => folder.files.filter(x => x.name === '포털_비서목록.json')[0];
  const agItems = () => post({action: 'agents_get', key: KS}).items;
  const cust = () => agItems().filter(x => !x.builtin);

  // ① 기본 참여자 6명은 서버가 이름·담당(duty)까지 알고 있다(2026-11-25 v28)
  let r = post({action: 'agents_get', key: KS});
  ok(r.ok === true && Array.isArray(r.items) && r.items.length === 6 && r.items.every(x => x.builtin === true), '처음엔 기본 참여자 6명만');
  ok(r.items.every(x => /^[a-z0-9_-]{2,12}$/.test(x.id) && typeof x.duty === 'string' && x.duty.length > 5), '기본 참여자 모두 담당(duty)이 있다');
  ok(r.max === 24, '명부 상한(24명)을 알려준다');

  // ② 화면 ＋추가 — 한 기기에서 넣은 비서가 다른 기기에서도 보인다
  r = post({action: 'agent_save', key: KS, items: [{id: 'cue2', name: '큐2', icon: '🎯', group: '일일', duty: '보조 리서치'}]});
  ok(r.ok === true && r.saved === 1 && r.items.some(x => x.id === 'cue2' && x.name === '큐2' && x.duty === '보조 리서치'), '새 비서(cue2)가 담당과 함께 명부에 들어간다');
  ok(!!agFile(), '드라이브에 포털_비서목록.json 이 생긴다');
  ok(cust().length === 1 && cust()[0].id === 'cue2', 'agents_get 로 같은 명부를 읽는다(다른 폰·PC)');

  // ③ 기본 참여자는 서버에 쌓지 않는다(화면·AG_BUILTINS 가 진짜)
  r = post({action: 'agent_save', key: KS, items: [{id: 'cue', name: '큐'}, {id: 'keyring', name: '키링'}]});
  ok(r.ok === true && cust().length === 1, '기본 참여자(cue·keyring)는 파일에 쌓지 않는다');

  // ④ 이름·담당 변경은 at 이 더 최근인 쪽이 이긴다
  const nowMs = Date.now();
  post({action: 'agent_save', key: KS, items: [{id: 'cue2', name: '큐투', duty: '자료 정리', at: new Date(nowMs).toISOString()}]});
  post({action: 'agent_save', key: KS, items: [{id: 'cue2', name: '옛이름', duty: '옛 담당', at: new Date(nowMs - 60000).toISOString()}]});
  ok(cust().filter(x => x.id === 'cue2')[0].name === '큐투' && cust().filter(x => x.id === 'cue2')[0].duty === '자료 정리', '오래된 이름·담당은 덮지 않는다');
  post({action: 'agent_save', key: KS, items: [{id: 'cue2', name: '큐2', at: new Date(nowMs + 60000).toISOString()}]});
  ok(cust().filter(x => x.id === 'cue2')[0].name === '큐2', '더 최근 이름은 덮는다(담당은 안 보냈으니 그대로)');
  ok(cust().filter(x => x.id === 'cue2')[0].duty === '자료 정리', '담당을 안 보내면 빈 값으로 지우지 않는다');

  // ⑤ 빼기
  r = post({action: 'agent_save', key: KS, removed: ['cue2']});
  ok(r.ok === true && r.removed === 1 && cust().length === 0, '뺀 비서는 명부에서 사라진다');

  // ⑥ 잘못된 값
  ok(post({action: 'agent_save', key: KS, items: [{id: 'BAD ID!', name: 'x'}]}).ok === false, '규칙에 안 맞는 id 는 거절');
  ok(post({action: 'agent_save', key: KS, items: []}).ok === false, '빈 요청은 거절');
  ok(post({action: 'agents_get', key: 'wrong'}).ok === false, '키 없이는 명부도 못 읽는다');

  // ⑦ 부분 사용량 보고 — 외부 비서가 자기 줄만 바꾼다
  //    (15)절이 pi1 을 '지금+1분'으로 넣어 두었으니 그보다 뒤 시각으로 움직인다)
  const t = n => new Date(nowMs + n * 1000).toISOString();
  post({action: 'usage_set', key: KS, items: [{id: 'pi1', pct: 77, at: t(300)}, {id: 'cue', pct: 55, at: t(300)}]});
  r = post({action: 'usage_report', key: KS, id: 'cue', pct: 12, note: '리서치 대기', at: t(360)});
  ok(r.ok === true && r.saved === 1, 'usage_report 한 건으로 보고');
  const ug = () => post({action: 'usage_get', key: KS}).items;
  ok(ug().filter(x => x.id === 'cue')[0].pct === 12, 'cue 줄만 갱신된다');
  ok(ug().filter(x => x.id === 'cue')[0].note === '리서치 대기', '한 줄 메모도 함께 남는다');
  ok(ug().filter(x => x.id === 'pi1')[0].pct === 77, '다른 비서(pi1) 값은 건드리지 않는다');
  post({action: 'usage_report', key: KS, id: 'cue', pct: 10, at: t(420)});
  ok(ug().filter(x => x.id === 'cue')[0].note === '리서치 대기', '메모를 안 보내면 이전 메모가 남는다(부분 갱신)');
  post({action: 'usage_report', key: KS, id: 'cue', pct: 9, note: '', at: t(480)});
  ok(!ug().filter(x => x.id === 'cue')[0].note, '빈 메모를 보내면 지운다');
  post({action: 'usage_report', key: KS, id: 'keyring', remain: 3, total: 10, status: 'soon', at: t(540)});
  ok(ug().filter(x => x.id === 'keyring')[0].pct === 30, 'remain+total 은 남은 %로 환산한다');
  ok(ug().filter(x => x.id === 'keyring')[0].status === 'soon', 'status 도 같이 남는다');
  ok(post({action: 'usage_report', key: KS, id: 'cue', pct: 120}).ok === false, '120% 는 거절');
  ok(post({action: 'usage_report', key: KS, id: 'BAD ID!', pct: 10}).ok === false, '규칙에 안 맞는 id 는 거절');
  ok(post({action: 'usage_report', key: KS, note: 'id 없음'}).ok === false, 'id 도 items 도 없으면 거절');
  ok(post({action: 'usage_get', key: KS}).ids.indexOf('keyring') >= 0, 'usage_get 의 ids 에 키링도 들어간다');

  // ⑧ 큐에 처음 말을 건 비서(sources_seen) — 화면이 참여자로 자동 합류시킨다
  const SHEET2 = 'SHEETidAgents001';
  const HEAD2 = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const mkRow = (id, source, payload) => {
    const row = new Array(HEAD2.length).fill('');
    row[HEAD2.indexOf('id')] = id;
    row[HEAD2.indexOf('created_at')] = '2026-11-25T18:00:00+09:00';
    row[HEAD2.indexOf('source')] = source;
    row[HEAD2.indexOf('type')] = 'claude_prompt';
    row[HEAD2.indexOf('payload')] = payload;
    row[HEAD2.indexOf('status')] = 'DONE';
    return row;
  };
  S.addSheet(SHEET2, {'Command_Queue': [HEAD2.slice(0),
    mkRow('Q-a1', 'portal', JSON.stringify({prompt: '안녕', mode: 'ask'})),
    mkRow('Q-a2', 'cue', JSON.stringify({prompt: '연결 확인', mode: 'ask'})),
    mkRow('Q-a3', 'vooy', JSON.stringify({prompt: '연결 확인', mode: 'ask'})),
    mkRow('Q-a4', 'keyring', JSON.stringify({prompt: '연결 확인', mode: 'ask'})),
    mkRow('Q-a5', 'cue2', JSON.stringify({prompt: '연결 확인', mode: 'ask'})),
    mkRow('Q-a6', 'pickle', JSON.stringify({prompt: '연결 확인', mode: 'ask'}))
  ]});
  S.props.QUEUE_SHEET_ID = SHEET2;
  r = post({action: 'queue_list', key: KS, limit: 10});
  ok(Array.isArray(r.sources_seen) && r.sources_seen.indexOf('cue') >= 0 && r.sources_seen.indexOf('vooy') >= 0 && r.sources_seen.indexOf('keyring') >= 0,
    'sources_seen 에 큐·부이·키링이 온다');
  ok(r.sources_seen.indexOf('portal') < 0, '내(portal) 말은 합류 후보가 아니다');
  ok(r.sources_seen.indexOf('cue2') >= 0, '새 비서(cue2)도 큐에 말을 걸면 후보로 온다');
  ok(r.sources_seen.indexOf('pickle') < 0, '피원 별칭(pickle)은 사람이 아니라 후보에서 뺀다');
  ok(JSON.stringify(r.targets) === JSON.stringify(['all', 'pi1', 'pi2', 'notebook', 'cue', 'vooy', 'keyring']),
    'targets 목록에 큐·부이·키링이 들어간다');
  ok(r.sources.indexOf('cue') >= 0 && r.sources.indexOf('keyring') >= 0, 'sources 목록에도 들어간다');

  // ⑨ 본문에 @이름만 적어도 그 비서 앞으로 — 화면 칩과 같은 규칙(서버도 한 번 더 본다)
  const enq = (prompt, extra) => post(Object.assign({action: 'queue_enqueue', key: KS, type: 'claude_prompt',
    workspace: 'gaegyebu', source: 'portal', payload: {prompt: prompt, mode: 'ask'}}, extra || {}));
  r = enq('@큐 이거 리서치해줘');
  ok(r.ok === true && r.item.target === 'cue', '@큐 만 적어도 target=cue 로 간다');
  r = enq('@키링 12월 3일 KTX 예약해줘');
  ok(r.item.target === 'keyring', '@키링 → target=keyring');
  r = enq('@부이 일정 비교해줘');
  ok(r.item.target === 'vooy', '@부이 → target=vooy');
  r = enq('@피투 이번 주 소재 뽑아줘');
  ok(r.item.target === 'pi2', '@피투 → target=pi2');
  r = enq('메일 a@b.com 으로 보내줘');
  ok(!r.item.target, '주소 속 @ 는 멘션으로 보지 않는다');
  r = enq('@큐2 그것도 봐줘');
  ok(r.item.target === 'cue2', '@큐2(명부에 오르기 전 부계정)도 큐투(cue2) 앞으로 간다');
  r = enq('@큐투 그것도 봐줘');
  ok(r.item.target === 'cue2', '@큐투 → cue2');
  r = enq('@뷔투 비교해줘');
  ok(r.item.target === 'vooy2', '@뷔투 → vooy2');
  r = enq('@부이2 비교해줘');
  ok(r.item.target === 'vooy2', '@부이2 → vooy2');
  r = enq('@키투 예약해줘');
  ok(r.item.target === 'keyring2', '@키투 → keyring2');
  r = enq('@키링투 예약해줘');
  ok(r.item.target === 'keyring2', '@키링투 → keyring2');
  r = enq('@cue2 확인해줘');
  ok(r.item.target === 'cue2', '@cue2 → cue2');
  r = enq('@vooy2 확인해줘');
  ok(r.item.target === 'vooy2', '@vooy2 → vooy2');
  post({action: 'agent_save', key: KS, items: [{id: 'cue2', name: '큐2'}]});
  r = enq('@큐2 그것도 봐줘');
  ok(r.item.target === 'cue2', '명부에 올린 비서 이름(@큐2)도 대상으로 잡힌다');
  r = enq('@전체 잠깐 모여봐');
  ok(r.item.target === 'all', '@전체 → target=all');
  r = enq('@피투야 봐줘', {payload: {prompt: '@피투야 봐줘', mode: 'ask', target: 'cue'}});
  ok(r.item.target === 'cue', '명시한 target 이 있으면 본문 멘션보다 우선한다');
}

console.log('17) 🔓 GET 읽기 · queue_claim/done · mentions·reply_to · 담당(duty) 노출');
{
  const KS = S.props.SECRET_KEY;
  const get = q => JSON.parse(S.sb.doGet({ parameter: q }).getContent());
  const SHEET3 = 'SHEETidClaim001';
  const HEAD3 = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const mkRow3 = (id, source, payload, status, extra) => {
    const row = new Array(HEAD3.length).fill('');
    row[HEAD3.indexOf('id')] = id;
    row[HEAD3.indexOf('created_at')] = '2026-11-25T18:00:00+09:00';
    row[HEAD3.indexOf('source')] = source;
    row[HEAD3.indexOf('type')] = 'claude_prompt';
    row[HEAD3.indexOf('payload')] = typeof payload === 'string' ? payload : JSON.stringify(payload);
    row[HEAD3.indexOf('status')] = status || 'PENDING';
    Object.keys(extra || {}).forEach(k => { const i = HEAD3.indexOf(k); if (i >= 0) row[i] = extra[k]; });
    return row;
  };
  S.addSheet(SHEET3, { 'Command_Queue': [HEAD3.slice(0),
    mkRow3('Q-k1', 'portal', { prompt: '@키링 12월 3일 KTX 예약해줘', mode: 'ask', kind: 'chat', target: 'keyring' }),
    mkRow3('Q-k2', 'portal', { prompt: '@큐 이 가격 맞는지 팩트체크해줘', mode: 'ask', kind: 'chat', target: 'cue' }),
    mkRow3('Q-k3', 'portal', { prompt: '제목 고쳐줘', mode: 'edit', target: 'keyring' }, 'WAITING_APPROVAL', { risk_level: 'HIGH', approval_expires_at: '2026-12-01T00:00:00+09:00' })
  ] });
  S.props.QUEUE_SHEET_ID = SHEET3;

  // ① GET — 읽기만, 키는 그대로
  ok(/POST로만/.test(get({}).error || ''), 'GET action 없으면 안내만');
  ok(get({ action: 'queue_list', key: 'nope' }).error === 'unauthorized', 'GET 도 키가 틀리면 거절');
  ok(get({ action: 'queue_enqueue', key: KS }).code === 'read_only', '쓰기 액션은 GET 으로 안 된다');
  ok(get({ action: 'queue_decide', key: KS }).code === 'read_only', '승인/거절도 GET 으로 안 된다');
  ok(get({ action: 'ping', key: KS }).ok === true, 'GET ping 은 된다');
  let g = get({ action: 'queue_list', key: KS, limit: 2 });
  ok(g.ok === true && Array.isArray(g.items) && g.items.length === 2, 'GET queue_list 가 최근 2건을 준다');
  g = get({ action: 'queue_list', key: KS, target: 'keyring', limit: 5 });
  ok(g.items.every(x => x.target === 'keyring' || x.target === 'all'), 'GET queue_list 도 target 필터가 먹는다');
  g = get({ action: 'queue_head', key: KS });
  ok(g.ok === true && g.item && g.item.id === 'Q-k3' && !g.item.summary, 'GET queue_head 는 최신 1건의 얇은 정보만');
  g = get({ action: 'queue_head', key: KS, target: 'cue' });
  ok(g.item && g.item.id === 'Q-k2', 'queue_head target=cue 는 내 앞 최신 글');
  g = get({ action: 'agents_get', key: KS });
  ok(g.ok === true && g.items.some(x => x.id === 'cue' && /팩트체크/.test(x.duty)), 'agents_get 에 큐의 확정 담당이 있다');
  ok(g.items.some(x => x.id === 'keyring' && /KTX/.test(x.duty)) && g.items.some(x => x.id === 'vooy' && /HWP/.test(x.duty)), '키링·부이 담당도 그대로');
  g = get({ action: 'usage_get', key: KS });
  ok(g.ok === true && g.duties && /피투|GitHub/.test(g.duties.pi2 || ''), 'usage_get 에 duties 표가 붙는다');
  g = get({ action: 'queue_list', key: KS, limit: 3 });
  ok(g.duties && /노트북|코드 실행/.test(g.duties.notebook || ''), 'queue_list 에도 duties 표가 붙는다');

  // ② mentions — 본문·대상에서 본 멘션 id 배열
  const item = id => post({ action: 'queue_list', key: KS, limit: 20 }).items.filter(x => x.id === id)[0];
  ok(JSON.stringify(item('Q-k1').mentions) === JSON.stringify(['keyring']), '본문 @키링 → mentions:keyring');
  ok(JSON.stringify(item('Q-k2').mentions) === JSON.stringify(['cue']), '본문 @큐 → mentions:cue');
  const r1 = post({ action: 'queue_enqueue', key: KS, type: 'claude_prompt', workspace: 'gaegyebu', source: 'pi1',
    payload: { prompt: '@큐 @피투 둘 다 확인해줘', mode: 'ask', kind: 'chat', target: 'portal' } });
  ok(r1.ok === true && (r1.item.mentions || []).indexOf('cue') >= 0 && (r1.item.mentions || []).indexOf('pi2') >= 0, '여러 멘션을 배열로 준다(@큐 @피투)');

  // ③ reply_to · replied_by — 답장 추적(중복 답장 방지)
  //  2026-11-26 — 주인(키링)이 답장하면 원글이 닫히므로(20절), 여기서는 곁에서 거든 피투의 답장으로 추적만 본다.
  const rr = post({ action: 'queue_enqueue', key: KS, type: 'claude_prompt', workspace: 'gaegyebu', source: 'pi2',
    payload: { prompt: '@포털 키링 예약 사이트 링크 붙여 둘게요', mode: 'ask', kind: 'chat', target: 'portal', reply_to: 'Q-k1' } });
  ok(rr.ok === true && rr.item.reply_to === 'Q-k1', 'reply_to 가 payload·item 에 실린다');
  ok(!rr.closed, '주인이 아닌 비서의 답장은 원글을 닫지 않는다');
  ok(item('Q-k1').replied_by === 'pi2' && !!item('Q-k1').replied_at, '답장이 달린 원본은 replied_by 가 보인다');
  ok(item('Q-k1').answer_by === 'pi2', '답장한 비서는 answer_by 로도 남는다');
  g = get({ action: 'queue_head', key: KS, target: 'keyring' });
  ok(g.item && typeof g.item.replied_by === 'string' && typeof g.item.reply_to === 'string', 'queue_head 에도 replied_by·reply_to 가 실린다');
  ok(post({ action: 'queue_enqueue', key: KS, type: 'claude_prompt', workspace: 'gaegyebu', source: 'portal',
    payload: { prompt: 'x', mode: 'ask', reply_to: 'bad id!' } }).ok === false, 'reply_to 형식이 틀리면 거절');

  // ④ queue_claim — 자기 앞 PENDING 만 집는다(중복 집기 방지)
  let c = post({ action: 'queue_claim', key: KS, as: 'keyring' });
  ok(c.ok === true && c.changed === true && c.item.id === 'Q-k1' && c.item.status === 'RUNNING' && c.item.claimed_by === 'keyring',
    '키링이 자기 앞 오더를 집는다(RUNNING·claimed_by=keyring)');
  ok(c.item.mentions.indexOf('keyring') >= 0 && c.item.target === 'keyring', '집은 오더에 멘션·대상이 그대로');
  c = post({ action: 'queue_claim', key: KS, as: 'keyring' });
  ok(c.ok === true && c.changed === false, '두 번째엔 집을 게 없다(이미 집었고 다른 keyring 앞 오더도 없다)');
  c = post({ action: 'queue_claim', key: KS, as: 'keyring', id: 'Q-k1' });
  ok(c.ok === true && c.changed === false && /이미 누가 집었/.test(c.reason || ''), '이미 집힌 오더는 결과만 알려 준다(중복 집기 방지)');
  ok(post({ action: 'queue_claim', key: KS, as: 'cue', id: 'Q-k3' }).ok === false, '승인 대기 오더는 id 로도 못 집는다');
  ok(post({ action: 'queue_claim', key: KS, as: 'portal' }).ok === false, 'as=portal 은 거절');
  ok(post({ action: 'queue_claim', key: KS }).ok === false, 'as 가 없으면 거절');
  c = post({ action: 'queue_claim', key: KS, as: 'cue' });
  ok(c.changed === true && c.item.id === 'Q-k2', '큐는 자기 앞 오더(Q-k2)를 집는다');
  c = post({ action: 'queue_claim', key: KS, as: 'keyring' });
  ok(c.changed === false, '승인 대기(Q-k3)는 집지 않는다');

  // ⑤ queue_done — 집은 사람만 결과를 쓸 수 있다
  ok(post({ action: 'queue_done', key: KS, as: 'cue', id: 'Q-k1', status: 'DONE', result: '남의 결과' }).ok === false, '남의 오더 결과는 못 쓴다');
  ok(post({ action: 'queue_done', key: KS, as: 'keyring', id: 'Q-k3', status: 'DONE' }).ok === false, '승인 대기 오더는 끝낼 수 없다');
  ok(post({ action: 'queue_done', key: KS, as: 'keyring', id: 'Q-k1', status: 'NOPE' }).ok === false, 'status 는 DONE/FAILED 만');
  let d = post({ action: 'queue_done', key: KS, as: 'keyring', id: 'Q-k1', status: 'DONE', result: '12/3 09:00 KTX 예약 완료', duration_ms: 4200 });
  ok(d.ok === true && d.changed === true && d.item.status === 'DONE' && /KTX 예약 완료/.test(d.item.result), '키링이 결과를 남긴다(DONE)');
  ok(d.item.replied_by === 'keyring' && d.item.exit_code === 0, 'replied_by·exit_code 도 맞다');
  d = post({ action: 'queue_done', key: KS, as: 'keyring', id: 'Q-k1', status: 'FAILED' });
  ok(d.changed === false && d.status === 'DONE', '이미 끝난 오더는 다시 안 쓴다');
  d = post({ action: 'queue_done', key: KS, as: 'cue', id: 'Q-k2', status: 'FAILED', error: '근거 부족' });
  ok(d.ok === true && d.item.status === 'FAILED' && /근거 부족/.test(d.item.error), '큐가 실패를 남긴다(FAILED)');

  // 2026-11-26 — 답장은 500자에서 자르지 않는다(문장 중간에 끊기던 것).
  const longReply = '첫 줄\n둘째 줄\n' + '다'.repeat(1200) + '\n마지막 줄';
  const q4 = post({ action: 'queue_enqueue', key: KS, type: 'claude_prompt', workspace: 'gaegyebu', source: 'portal',
    payload: { prompt: '긴 답장 시험', mode: 'ask', kind: 'chat', target: 'cue' } });
  ok(post({ action: 'queue_claim', key: KS, as: 'cue', id: q4.item.id }).changed === true, '긴 답장 시험 오더를 큐가 집는다');
  const d4 = post({ action: 'queue_done', key: KS, as: 'cue', id: q4.item.id, status: 'DONE', result: longReply });
  ok(d4.ok === true && d4.item.result === longReply, '1,200자 넘는 답장도 잘리지 않고 그대로 남는다');
  const listed = post({ action: 'queue_list', key: KS, limit: 20 }).items.filter(x => x.id === q4.item.id)[0] || {};
  ok(listed.result === longReply, 'queue_list 의 result 도 전체 본문');

  // ⑥ 화면에서 추가한 부계정 비서(cue2)도 targets·sources·멘션에 바로 잡힌다
  post({ action: 'agent_save', key: KS, items: [{ id: 'cue2', name: '큐2', icon: '🌀', duty: '보조 팩트체크' }] });
  g = post({ action: 'queue_list', key: KS, limit: 5 });
  ok(g.targets.indexOf('cue2') >= 0 && g.sources.indexOf('cue2') >= 0, '명부에 오른 cue2 가 targets·sources 에도 들어간다');
  ok(g.duties.cue2 === '보조 팩트체크', 'duties 에도 그 비서의 담당');
  const r2 = post({ action: 'queue_enqueue', key: KS, type: 'claude_prompt', workspace: 'gaegyebu', source: 'cue2',
    payload: { prompt: '@큐2 이것도 확인해줘', mode: 'ask', kind: 'chat', target: 'cue2' } });
  ok(r2.ok === true && r2.item.target === 'cue2' && (r2.item.mentions || []).indexOf('cue2') >= 0, 'cue2 앞 오더와 멘션이 정상으로 잡힌다');
  g = get({ action: 'queue_list', key: KS, target: 'cue2', limit: 5 });
  ok(g.ok === true && g.items.length === 1 && g.items[0].id === r2.item.id, 'GET target=cue2 필터도 새 비서를 잡는다');

  // ⑦ 사람(포털) 앞 대화는 아무도 실행하지 않는다 — 접수 순간에 DONE 으로 닫는다(2026-11-25)
  const beforePend = post({ action: 'queue_list', key: KS, limit: 5 }).pending;
  const del = post({ action: 'queue_enqueue', key: KS, type: 'claude_prompt', workspace: 'gaegyebu', source: 'cue',
    payload: { prompt: '@포털 연결 확인했어요', mode: 'ask', kind: 'chat', target: 'portal' } });
  ok(del.ok === true && del.item.status === 'DONE' && !!del.item.finished_at, '포털 앞 대화는 바로 DONE');
  ok(/전달/.test(del.note || ''), '안내도 전달했다고 나온다');
  ok(post({ action: 'queue_list', key: KS, limit: 5 }).pending === beforePend, '대기 건수가 늘지 않는다');
  const toAll = post({ action: 'queue_enqueue', key: KS, type: 'claude_prompt', workspace: 'gaegyebu', source: 'cue',
    payload: { prompt: '@전체 다들 확인', mode: 'ask', kind: 'chat', target: 'all' } });
  ok(toAll.item.status === 'DONE', '@전체 대화는 접수 순간 전달 완료로 닫힌다(2026-11-27 — 영원히 대기로 남아 브리핑을 부풀렸다)');
  const plain = post({ action: 'queue_enqueue', key: KS, type: 'claude_prompt', workspace: 'gaegyebu', source: 'portal',
    payload: { prompt: '제목만 고쳐줘', mode: 'ask' } });
  ok(plain.item.status === 'PENDING', '보통 오더는 그대로 PENDING');
}

console.log('18) 🤝 협업 필요 줄 자동 멘션 · 발신자 source 보정 · 봉투 필드 승계 (2026-11-26)');
{
  const KP = S.props.SECRET_KEY;
  const SHEETP = 'SHEETidCollab1801';
  const HEADP = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  S.addSheet(SHEETP, { 'Command_Queue': [HEADP.slice(0)] });
  S.props.QUEUE_SHEET_ID = SHEETP;
  const prows = () => S.books[SHEETP]['Command_Queue'];
  const prow = id => prows().filter(x => x[0] === id)[0] || [];
  const enqP = (extra) => post(Object.assign({ action: 'queue_enqueue', key: KP, type: 'claude_prompt', workspace: 'gaegyebu' }, extra));
  const chatP = (prompt, extra) => Object.assign({ payload: { prompt: prompt, mode: 'ask', kind: 'chat', target: 'portal' } }, extra || {});
  const payloadOf = id => JSON.parse(prow(id)[5] || '{}');

  // ① '4. 협업 필요:' 줄에 @ 없이 적은 이름도 mentions 에 들어간다
  let c1 = enqP(Object.assign({ source: 'keyring' }, chatP('조사 마쳤습니다.\n\n4. 협업 필요: 노트북(구현), pi2(PR 머지)')));
  ok(c1.ok === true, '협업 줄이 든 보고도 접수된다');
  ok((c1.item.mentions || []).indexOf('notebook') >= 0 && (c1.item.mentions || []).indexOf('pi2') >= 0, "'협업 필요: 노트북(구현), pi2(PR 머지)' → mentions 에 notebook·pi2");
  // ② 자기 자신(source)은 멘션에서 빠진다
  const c2 = enqP(Object.assign({ source: 'pi2' }, chatP('4. 협업 필요: 피투 확인, 노트북 빌드')));
  ok((c2.item.mentions || []).indexOf('notebook') >= 0 && (c2.item.mentions || []).indexOf('pi2') < 0, 'source=pi2 면 자기(pi2)는 멘션에서 뺀다');
  // ③ '없음' 은 무반응
  const c3 = enqP(Object.assign({ source: 'keyring' }, chatP('1. 프로젝트: 포털\n2. 완료 작업: 정리\n3. 앞으로 할 작업: 없음\n4. 협업 필요: 없음')));
  ok((c3.item.mentions || []).length === 0, "'협업 필요: 없음' 은 멘션이 없다");
  // ④ 확정 호칭(키투)·조사(에게)도 같은 비서로
  const c4 = enqP(Object.assign({ source: 'vooy' }, chatP('4) 협업 필요: 키투에게 넘김')));
  ok((c4.item.mentions || []).indexOf('keyring2') >= 0, "'4) 협업 필요: 키투에게' → keyring2");
  // ④-2 마크다운 별표·대괄호 번호도 같은 줄로 읽는다(비서 보고서는 **4. 협업 필요:** 처럼도 쓴다)
  const c4b = enqP(Object.assign({ source: 'pi1' }, chatP('**4. 협업 필요:** 노트북(모달), 피투(PR)')));
  ok((c4b.item.mentions || []).indexOf('notebook') >= 0 && (c4b.item.mentions || []).indexOf('pi2') >= 0, '**4. 협업 필요:** 굵은 글씨 줄도 읽는다');
  const c4c = enqP(Object.assign({ source: 'pi1' }, chatP('[4] 협업 필요: 큐투에게 넘김')));
  ok((c4c.item.mentions || []).indexOf('cue2') >= 0, '[4] 협업 필요: 도 읽는다');

  // ⑤ 낱말 속 글자는 이름으로 오해하지 않는다
  const c5 = enqP(Object.assign({ source: 'pi2' }, chatP('4. 협업 필요: 큐레이션 담당 확인')));
  ok((c5.item.mentions || []).length === 0, "'큐레이션' 의 '큐' 를 멘션으로 오해하지 않는다");
  // ⑥ 줄바꿈 목록은 같은 협업 줄 — 다음 번호 항목은 다른 줄
  const c6 = enqP(Object.assign({ source: 'pi1' }, chatP('4. 협업 필요:\n   - 노트북(웹앱 모달)\n   - 부이(체크리스트)\n5. 다음: 피투가 확인')));
  ok((c6.item.mentions || []).indexOf('notebook') >= 0 && (c6.item.mentions || []).indexOf('vooy') >= 0, '줄바꿈 목록의 이름도 읽는다(노트북·부이)');
  ok((c6.item.mentions || []).indexOf('pi2') < 0, '다음 번호 항목(5.)의 이름은 이 협업 줄이 아니다');
  // ⑥-2 사용자가 준 이름·ID 전부가 같은 비서로 읽힌다(별칭 표)
  const alias = [['pi1','pi1'],['피원','pi1'],['pi2','pi2'],['피투','pi2'],['notebook','notebook'],['노트북','notebook'],
    ['cue','cue'],['큐','cue'],['cue2','cue2'],['큐투','cue2'],['큐2','cue2'],['vooy','vooy'],['부이','vooy'],
    ['vooy2','vooy2'],['뷔투','vooy2'],['부이2','vooy2'],['keyring','keyring'],['키링','keyring'],
    ['keyring2','keyring2'],['키투','keyring2'],['키링2','keyring2']];
  const missed = alias.filter(p => {
    const r = enqP(Object.assign({ source: 'portal' }, chatP('4. 협업 필요: ' + p[0] + ' 진행')));
    return (r.item.mentions || []).indexOf(p[1]) < 0;
  });
  ok(missed.length === 0, '협업 줄의 이름·ID 21종이 모두 제 id 로 읽힌다(놓치면: ' + missed.map(x => x[0]).join(',') + ')');

  // ⑦ @멘션 규칙은 그대로(중복 없이 하나로)
  const c7 = enqP(Object.assign({ source: 'portal' }, chatP('@노트북 봐줘\n4. 협업 필요: 노트북, 큐')));
  ok((c7.item.mentions || []).filter(x => x === 'notebook').length === 1 && (c7.item.mentions || []).indexOf('cue') >= 0, '@멘션과 협업 줄이 겹쳐도 하나로 합친다');

  // ⑧ source 를 빼먹은 답장 — replied_by 가 있으면 그 비서의 말
  const b1 = enqP(Object.assign({}, chatP('예약 완료했습니다.', { replied_by: 'keyring2' })));
  ok(b1.ok === true && b1.item.source === 'keyring2', 'source 생략 + replied_by:keyring2 → source=keyring2');
  ok(prow(b1.item.id)[2] === 'keyring2', '시트 source 칸에도 keyring2 가 남는다(portal 아님)');
  // ⑨ source:'portal' 이 명시돼 있어도 replied_by(비서)면 그 비서
  const b2 = enqP(Object.assign({ source: 'portal' }, chatP('확인했습니다.', { replied_by: 'keyring2' })));
  ok(b2.item.source === 'keyring2', 'replied_by 가 있으면 명시적 source:portal 보다 우선');
  // ⑩ source 생략 + reply_to — 원글이 비서 앞이고 AI 보고 모양이면 원글 target
  const orig = enqP(Object.assign({ source: 'pi1' }, { payload: { prompt: '@피투 이거 PR 로 올려줘', mode: 'ask', kind: 'chat', target: 'pi2' } }));
  const b3 = enqP(Object.assign({}, chatP('1. 프로젝트: 포털\n2. 완료 작업: PR 올림\n3. 앞으로 할 작업: 머지', { reply_to: orig.item.id })));
  ok(b3.item.source === 'pi2', 'source 생략 + reply_to(원글 target=pi2) + AI 보고 모양 → source=pi2');
  // ⑪ 원글이 포털(사람) 앞이면 source 는 portal 그대로
  const origP = enqP(Object.assign({ source: 'cue' }, chatP('들었어요')));
  const b4 = enqP(Object.assign({}, chatP('1. 프로젝트: 포털 확인', { reply_to: origP.item.id })));
  ok(b4.item.source === 'portal', '원글 target=portal 이면 source 는 portal(사람)로 남는다');
  // ⑫ 포털 UI 처럼 source:'portal' 을 명시하면 reply_to 추측을 하지 않는다
  const b5 = enqP(Object.assign({ source: 'portal' }, chatP('1. 프로젝트: 사용자가 보낸 글', { reply_to: orig.item.id })));
  ok(b5.item.source === 'portal', '명시된 source:portal 은 그대로 존중한다');

  // ⑬ 봉투(바깥)에 적은 kind·target 도 payload 로 승계 — 대화가 '오더 요약'으로 저장되지 않는다
  const TOP = '레이 님, 3건 보고합니다.\n\n1. 프로젝트: 포털\n2. 완료 작업: ' + '가'.repeat(300) + '\n3. 앞으로 할 작업: 점검\n4. 협업 필요: 없음';
  const e1 = enqP({ source: 'pi1', kind: 'chat', target: 'portal', summary: TOP, payload: { prompt: TOP } });
  ok(e1.ok === true && e1.item.kind === 'chat', '바깥 kind:"chat" 이 payload 로 승계된다');
  ok(e1.item.target === 'portal', '바깥 target:"portal" 이 본문 @멘션에 덮이지 않는다');
  const p1 = payloadOf(e1.item.id);
  ok(p1.prompt === TOP, '시트 payload.prompt 에 원문이 그대로 있다(줄바꿈 포함)');
  ok(p1.kind === 'chat', '시트 payload 에도 kind 가 남는다');
  ok(e1.item.summary === TOP.replace(/\r\n?/g, '\n'), '300자 넘는 대화도 자르지 않고 그대로 돌려준다');
  // ⑭ 오더(대화 아님)도 160자에서 자르지 않는다 — '클로드: ' 접두사도 없다
  const longOrder = '오더 내용 ' + '나'.repeat(400);
  const e2 = enqP({ source: 'portal', payload: { prompt: longOrder, mode: 'ask' } });
  ok(e2.item.summary === longOrder && e2.item.summary.indexOf('클로드: ') !== 0, '긴 오더 요약도 접두사·160자 컷 없이 본문 그대로');
  // ⑮ payload 없이 바깥 prompt/kind/target 만 적어도 접수된다
  const e3 = enqP({ source: 'pi1', kind: 'chat', target: 'portal', prompt: '바깥에만 적은 글' });
  ok(e3.ok === true && e3.item.kind === 'chat' && e3.item.target === 'portal', '바깥 prompt 만으로도 대화가 접수된다');
  // ⑯ payload 가 JSON 문자열이어도 같은 규칙
  const e4 = enqP({ source: 'pi1', kind: 'chat', target: 'portal', payload: JSON.stringify({ prompt: '문자열 payload 대화' }) });
  ok(e4.ok === true && e4.item.kind === 'chat' && e4.item.target === 'portal' && payloadOf(e4.item.id).prompt === '문자열 payload 대화', 'payload 가 JSON 문자열이어도 kind·target 이 붙고 글이 그대로 남는다');
  // ⑰ 예전처럼 payload 가 글 자체인 창구도 그대로
  const e5 = enqP({ source: 'portal', payload: '글 자체로 보낸 오더' });
  ok(e5.ok === true && e5.item.summary === '글 자체로 보낸 오더', 'payload 가 글 자체여도 그 글이 오더 내용이 된다');
  // ⑱ 이 배포 표시
  const mark = post({ action: 'queue_list', key: KP, limit: 1 });
  ok(mark.source_fallback === true && mark.mention_auto === true, 'queue_list 가 source_fallback·mention_auto 표식을 준다(배포 확인용)');
}

console.log('19) ✅ 완료 보고 — answered · report_rule · needs_report (2026-11-26)');
{
  const KR = S.props.SECRET_KEY;
  const SHEETR = 'SHEETidReport1901';
  const HEADR = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const mkRowR = (id, source, payload, status, extra) => {
    const row = new Array(HEADR.length).fill('');
    row[HEADR.indexOf('id')] = id;
    row[HEADR.indexOf('created_at')] = '2026-11-26T10:00:00+09:00';
    row[HEADR.indexOf('source')] = source;
    row[HEADR.indexOf('type')] = 'claude_prompt';
    row[HEADR.indexOf('payload')] = typeof payload === 'string' ? payload : JSON.stringify(payload);
    row[HEADR.indexOf('status')] = status || 'PENDING';
    Object.keys(extra || {}).forEach(k => { const i = HEADR.indexOf(k); if (i >= 0) row[i] = extra[k]; });
    return row;
  };
  S.addSheet(SHEETR, { 'Command_Queue': [HEADR.slice(0),
    mkRowR('Q-p1', 'portal', { prompt: '@큐 약속 잡아줘', mode: 'ask', kind: 'chat', target: 'cue' }, 'DONE',
      { claimed_by: 'cue', finished_at: '2026-11-26T10:05:00+09:00', result: '금요일 15시로 잡았습니다' }),
    mkRowR('Q-p2', 'portal', { prompt: '@키링 택배 확인해줘', mode: 'ask', kind: 'chat', target: 'keyring' }, 'PENDING'),
    mkRowR('Q-p3', 'portal', { prompt: '@부이 비교표 만들어줘', mode: 'ask', kind: 'chat', target: 'vooy' }, 'PENDING')
  ] });
  S.props.QUEUE_SHEET_ID = SHEETR;
  const itemR = id => post({ action: 'queue_list', key: KR, limit: 20 }).items.filter(x => x.id === id)[0] || {};

  // ① 후속 보고가 없으면 answered=false — 화면은 이걸로 「완료·보고누락」을 그린다
  ok(itemR('Q-p1').answered === false, '보고가 없으면 answered=false');
  const rep = post({ action: 'queue_enqueue', key: KR, type: 'claude_prompt', workspace: 'gaegyebu', source: 'cue',
    payload: { prompt: '@포털 금요일 15시로 잡았습니다', mode: 'ask', kind: 'chat', target: 'portal', reply_to: 'Q-p1' } });
  ok(rep.ok === true, '비서가 같은 오더에 답장(보고)을 남긴다');
  ok(itemR('Q-p1').answered === true && itemR('Q-p1').answer_by === 'cue', '보고가 달리면 answered=true · answer_by');

  // ② 규칙은 저장되는 프롬프트를 건드리지 않고 **응답**으로 나간다(승인 해시·다른 화면이 안 바뀌게)
  ok(/보고/.test(rep.report_rule || '') && /reply_to/.test(rep.report_rule || ''), 'queue_enqueue 응답에 보고 규칙이 실린다');
  const claimed = post({ action: 'queue_claim', key: KR, as: 'keyring', id: 'Q-p2' });
  ok(claimed.ok === true && /보고/.test(claimed.report_rule || ''), 'queue_claim 응답에도 보고 규칙(집은 비서가 바로 읽게)');
  ok(String(claimed.item.summary || '').indexOf('[보고 규칙]') < 0, '저장된 본문에는 규칙 문구가 섞이지 않는다');

  // ③ 결과가 비면 needs_report — 비서가 한 줄이라도 남기게
  const empty = post({ action: 'queue_done', key: KR, as: 'keyring', id: 'Q-p2', status: 'DONE' });
  ok(empty.ok === true && empty.needs_report === true && /결과가 비어/.test(empty.hint || ''), '결과 없이 끝내면 needs_report·안내');
  const full = post({ action: 'queue_done', key: KR, as: 'vooy', id: 'Q-p3', status: 'DONE', result: '세 곳 비교표를 만들었어요 — 가격·평점·거리 순' });
  ok(full.ok === true && full.needs_report === false && full.hint === '', '결과를 적었으면 needs_report=false');

  // ④ 답장 자신은 또 다른 답장을 요구하지 않는다(무한 보고 방지)
  ok(itemR(rep.item.id).answered === false, '답장 줄은 누군가의 보고 대상이 아니다(자기 자신은 reply_to 없음)');
}

console.log('20) ↩ 답장하면 원글을 닫는다 · 📋 오늘 브리핑(queue_brief) · 서버 버전 (2026-11-26)');
{
  const KB = S.props.SECRET_KEY;
  const SHEETB = 'SHEETidBrief2001';
  const HEADB = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const now = S.sb.Date.now();                       // 가짜 서버 시계(2026-10-13 12:00 KST) 기준으로 '오늘'
  const iso = ms => new Date(ms).toISOString();
  const mkB =(id, ago, source, payload, status, extra, type) => {
    const row = new Array(HEADB.length).fill('');
    row[HEADB.indexOf('id')] = id;
    row[HEADB.indexOf('created_at')] = iso(now - ago * 60000);
    row[HEADB.indexOf('source')] = source;
    row[HEADB.indexOf('type')] = type || 'claude_prompt';
    row[HEADB.indexOf('payload')] = JSON.stringify(payload);
    row[HEADB.indexOf('status')] = status || 'PENDING';
    Object.keys(extra || {}).forEach(k => { const i = HEADB.indexOf(k); if (i >= 0) row[i] = extra[k]; });
    return row;
  };
  const chat = (target, prompt, x) => Object.assign({ prompt, mode: 'ask', kind: 'chat', target }, x || {});
  S.addSheet(SHEETB, { 'Command_Queue': [HEADB.slice(0),
    mkB('Q-b1', 300, 'pi1', chat('cue', '[임명] 큐 — 오늘부터 일정 전담이에요')),                     // 큐: 안 읽음(가장 오래)
    mkB('Q-b2', 120, 'portal', chat('cue', '@큐 내일 일정 알려줘')),                                // 큐: 답은 했는데 안 닫음(아래 b3)
    mkB('Q-b3', 110, 'cue', chat('portal', '내일은 10시 치과 한 건이에요', { reply_to: 'Q-b2' }), 'DONE'),
    mkB('Q-b4', 60, 'vooy', chat('pi1', '@피원 확인했어요.'), 'DONE', { claimed_by: 'pi1', finished_at: iso(now - 55 * 60000), result: '수신 완료' }),
    mkB('Q-b5', 50, 'vooy', chat('pi1', '@피원 확인했어요. 이 오더 닫을게요.'), 'DONE', { claimed_by: 'pi1', finished_at: iso(now - 45 * 60000), result: '수신 완료' }),
    mkB('Q-b6', 40, 'portal', chat('all', '@전체 다들 상태 알려줘')),                                // 전체 앞 — 누구의 '안 읽음'도 아니다
    mkB('Q-b7', 30, 'portal', { prompt: '가계부 최신화', mode: 'ask' }, 'PENDING', {}, 'claude_prompt'), // 노트북 앞 실행 오더
    mkB('Q-b8', 20, 'portal', chat('vooy2', '@뷔투 협업 태그 왜 안 해?')),                           // 뷔투: 안 읽음
    mkB('Q-b9', 10, 'pi2', chat('portal', 'PR #26 올렸어요 — 카드뉴스 1차')),                         // 나에게 온 말
    mkB('Q-b10', 5, 'portal', chat('keyring', '@키링 기차표 봐줘'), 'FAILED', { claimed_by: 'keyring', finished_at: iso(now - 2 * 60000), error: '예약 사이트 접속 실패' })
  ] });
  S.props.QUEUE_SHEET_ID = SHEETB;
  const rowOf = id => { const sh = S.books[SHEETB]['Command_Queue']; return sh.find(r => r[0] === id) || []; };
  const col = (id, k) => rowOf(id)[HEADB.indexOf(k)];

  // ⓪ 서버 버전 — 배포가 무엇인지 화면이 확인할 수 있게
  let p = post({ action: 'ping', key: KB });
  ok(p.ok === true && /^\d{4}-\d{2}-\d{2}\./.test(p.version || ''), 'ping 이 서버 버전을 돌려준다');
  p = JSON.parse(S.sb.doGet({ parameter: { action: 'ping', key: KB } }).getContent());
  ok(p.ok === true && p.version === post({ action: 'ping', key: KB }).version, 'GET ping 도 같은 버전');

  // ① 브리핑 — 답장 자동 닫기 전 상태를 먼저 본다
  let b = post({ action: 'queue_brief', key: KB });
  const ag = id => (b.agents || []).find(a => a.id === id) || {};
  ok(b.ok === true && b.scanned === 10 && b.version === p.version, '브리핑 응답 — 훑은 줄 수·버전');
  ok((b.agents || []).slice(0, 9).map(a => a.id).join(',') === 'pi1,pi2,cue,cue2,vooy,vooy2,keyring,keyring2,notebook', '비서 9명이 정해진 순서로 온다(기록이 없어도)');
  ok(ag('cue').unread === 1 && ag('cue').replied_open === 1, '큐 — 안 읽음 1 · 답만 하고 안 닫음 1 을 가른다');
  ok(ag('cue').oldest_unread && ag('cue').oldest_unread.id === 'Q-b1' && ag('cue').oldest_unread.from === 'pi1' && /임명/.test(ag('cue').oldest_unread.text), '가장 오래 안 읽은 말 — 누가·무슨 말');
  ok(ag('vooy2').unread === 1 && ag('pi1').unread === 0, '뷔투 안 읽음 1 · 피원은 다 처리');
  ok(ag('pi1').handled_today === 2, '피원 오늘 처리 2(부이가 보낸 두 말을 끝냄)');
  ok(ag('cue').handled_today === 1, '큐 오늘 처리 1(답장 단 원글 기준)');
  ok(ag('vooy').sent_today === 2 && ag('vooy').acks_today === 2, '부이 — 보낸 말 2 중 확인만 한 말 2');
  ok(ag('cue').acks_today === 0, '내용 있는 답장은 확인만 한 말이 아니다');
  ok(ag('keyring').failed_today === 1 && b.totals.failed_today === 1, '키링 오늘 실패 1');
  ok(ag('notebook').unread === 1, '대상 없는 실행 오더는 노트북의 안 읽음');
  ok(b.totals.all_open === 1 && b.totals.unread === 3 && b.totals.replied_open === 1, '전체 앞 말은 따로 · 합계');
  ok(b.totals.to_me_today === 2, '오늘 나에게 온 말(큐 답장 · 피투 PR)');
  ok(ag('pi2').last && ag('pi2').last.kind === 'sent' && /PR #26/.test(ag('pi2').last.text) && ag('pi2').last.to === 'portal', '마지막 활동 — 보낸 말과 받는 쪽');
  ok(ag('pi1').last && ag('pi1').last.kind === 'done' && ag('pi1').last.text === '수신 완료', '끝낸 일이 마지막이면 그 결과 글');
  ok(!JSON.stringify(b).includes('"payload"'), '브리핑은 payload 원문을 내보내지 않는다');
  const gb = JSON.parse(S.sb.doGet({ parameter: { action: 'queue_brief', key: KB } }).getContent());
  ok(gb.ok === true && gb.agents.length === b.agents.length, 'GET queue_brief 도 읽힌다(비서가 자기 밀린 일 확인)');
  ok(post({ action: 'queue_brief' }).error === 'unauthorized', '키 없으면 거절');

  // ② 답장하면 원글을 닫는다 — 주인이 답했을 때만
  const enq = (source, payload) => post({ action: 'queue_enqueue', key: KB, type: 'claude_prompt', workspace: 'gaegyebu', source, payload });
  let e = enq('cue', chat('pi1', '@피원 일정 전담 맡을게요 — 내일 아침부터 브리핑', { reply_to: 'Q-b1' }));
  ok(e.ok === true && e.closed && e.closed.id === 'Q-b1' && e.closed.by === 'cue', '주인(큐)이 답장하면 원글을 닫고 응답에 알린다');
  ok(col('Q-b1', 'status') === 'DONE' && col('Q-b1', 'claimed_by') === 'cue' && String(col('Q-b1', 'result')).indexOf('↩ 답장 ' + e.item.id) === 0, '원글 DONE · 처리자 · 결과칸에 답장 id');
  e = enq('pi1', chat('portal', '뷔투 대신 답할게요', { reply_to: 'Q-b8' }));
  ok(e.ok === true && !e.closed && col('Q-b8', 'status') === 'PENDING', '주인이 아닌 비서의 답장은 원글을 닫지 않는다');
  e = enq('cue', chat('portal', '큐는 이상 없어요', { reply_to: 'Q-b6' }));
  ok(!e.closed && col('Q-b6', 'status') === 'PENDING', '@전체 원글은 한 명이 답해도 닫지 않는다');
  e = enq('pi2', chat('portal', '노트북 일인데 제가 답해요', { reply_to: 'Q-b7' }));
  ok(!e.closed && col('Q-b7', 'status') === 'PENDING', '노트북 앞 실행 오더는 답장으로 닫지 않는다');
  e = enq('portal', chat('vooy2', '레이가 다시 묻는다', { reply_to: 'Q-b8' }));
  ok(!e.closed && col('Q-b8', 'status') === 'PENDING', '사람(portal)의 답장은 원글을 닫지 않는다');

  // ③ 자동으로 닫힌 뒤 queue_done 으로 결과를 주면 그 결과로 바뀐다(결과를 잃지 않는다)
  const d = post({ action: 'queue_done', key: KB, as: 'cue', id: 'Q-b1', status: 'DONE', result: '일정 전담 시작 — 내일 07:30 첫 브리핑' });
  ok(d.ok === true && d.changed === true && col('Q-b1', 'result') === '일정 전담 시작 — 내일 07:30 첫 브리핑', '답장으로 닫힌 오더에 나중 결과를 덧붙인다');
  const d2 = post({ action: 'queue_done', key: KB, as: 'cue', id: 'Q-b1', status: 'DONE', result: '두 번째 결과' });
  ok(d2.changed === false && col('Q-b1', 'result') === '일정 전담 시작 — 내일 07:30 첫 브리핑', '진짜 결과가 적힌 뒤에는 덮지 않는다');

  // ④ 닫은 뒤 브리핑 — 큐의 안 읽음이 사라진다
  b = post({ action: 'queue_brief', key: KB });
  ok(ag('cue').unread === 0 && ag('cue').handled_today >= 2, '답장으로 닫힌 뒤 큐 안 읽음 0 · 오늘 처리 늘어남');

  // ⑤ 📥 주기 확인형 비서(키링·부이 계열) — 받은편지함 한 번에 '지금 처리할 말'만
  S.props.WEBHOOK_TRIGGERS_JSON = JSON.stringify({ cue: 'https://hook.test/cue' });
  S.sb.CacheService.getScriptCache().put('qq_check_log_v1', '{}');   // 앞 절의 확인 기록을 비우고 시작
  let ib = post({ action: 'queue_inbox', key: KB, as: 'vooy2' });
  const ids = ib.items.map(x => x.id);
  ok(ib.ok === true && ib.count === 3 && ids.indexOf('Q-b6') >= 0 && ids.indexOf('Q-b8') >= 0, '뷔투 받은편지함 = 뷔투 앞 2(원글·레이의 재질문) + @전체 1');
  ok(/reply_to/.test(ib.how || '') && /보고/.test(ib.report_rule || ''), '답하는 법·보고 규칙을 같이 준다');
  enq('vooy2', chat('portal', '태그 규칙 지킬게요 — 다음 보고부터 협업 줄에 이름 넣습니다', { reply_to: 'Q-b8' }));
  ib = post({ action: 'queue_inbox', key: KB, as: 'vooy2' });
  ok(ib.count === 1 && ib.items.every(x => x.id !== 'Q-b8' && x.id !== 'Q-b6'), '답한 말은 빠지고, @전체 말은 첫 전달 뒤 다시 보이지 않는다(한 번만) — 내 앞 재질문만 남는다');
  ok(ib.cast === 0 && ib.items[0].target === 'vooy2', '남은 건 내 앞으로 온 말(답하거나 닫힐 때까지 계속 보인다)');
  enq('vooy2', chat('portal', '뷔투 상태 정상', { reply_to: 'Q-b6' }));
  ib = post({ action: 'queue_inbox', key: KB, as: 'vooy2' });
  ok(ib.count === 1 && ib.items.every(x => x.id !== 'Q-b6'), '@전체 말은 닫히지 않지만 내 받은편지함에서는 빠진다');
  // 본문 @멘션으로만 부른 말 — target 이 다른 비서여도 부른 비서의 받은편지함에 '한 번' 들어온다(웹훅 없는 비서용)
  post({ action: 'queue_inbox', key: KB, as: 'keyring2' });     // 먼저 한 번 확인(앞서 온 @전체 말은 여기서 전달됨)
  enq('pi1', chat('cue', '@큐 일정 정리해줘\n4. 협업 필요: 키투(예약 확인)'));
  let ik = post({ action: 'queue_inbox', key: KB, as: 'keyring2' });
  ok(ik.count === 1 && ik.cast === 0 && ik.items[0].target === 'keyring2' && /협업 요청/.test(ik.items[0].summary), '협업 줄로 부른 비서에겐 협업 요청이 할 일로 직접 들어온다(원 보고 멘션은 중복으로 안 준다)');
  ik = post({ action: 'queue_inbox', key: KB, as: 'keyring2', since: ik.items[0].created_at });
  ok(ik.cast === 0 && ik.count === 0, '두 번째 확인(since=받은 시각)에는 다시 오지 않는다');
  ok(post({ action: 'queue_inbox', key: KB, as: 'pi2' }).items.every(x => x.target !== 'cue' || !/키투/.test(x.summary)), '멘션되지 않은 비서(피투)에게는 가지 않는다');
  ok(post({ action: 'queue_inbox', key: KB, as: 'vooy2', since: new Date(now + 60000).toISOString() }).count === 0, 'since 이후 새 말만');
  ok(post({ action: 'queue_inbox', key: KB }).ok === false && post({ action: 'queue_inbox', key: KB, as: 'portal' }).ok === false, 'as 가 없거나 portal 이면 거절');
  const gi = JSON.parse(S.sb.doGet({ parameter: { action: 'queue_inbox', key: KB, as: 'keyring' } }).getContent());
  ok(gi.ok === true && gi.as === 'keyring', 'GET queue_inbox 도 읽힌다(주기 확인용)');
  // 확인 기록 — 받은편지함·queue_head target 을 읽으면 브리핑에 '마지막 확인'이 남는다
  S.sb.doGet({ parameter: { action: 'queue_head', key: KB, target: 'keyring2' } });
  b = post({ action: 'queue_brief', key: KB });
  ok(!!ag('vooy2').last_check_at && !!ag('keyring').last_check_at && !!ag('keyring2').last_check_at, '확인한 비서는 last_check_at 이 남는다');
  ok(ag('vooy').last_check_at === '', '확인한 적 없으면 비어 있다(지어내지 않는다)');
  ok(ag('cue').wake === 'webhook' && ag('vooy').wake === 'poll' && ag('keyring2').wake === 'poll' && ag('notebook').wake === 'worker', '깨우는 방식 — 웹훅 / 주기 확인 / 워커');
  ok(!JSON.stringify(b).includes('hook.test'), '브리핑에 웹훅 주소가 나가지 않는다');
  const wl = post({ action: 'webhook_last', key: KB });
  ok(wl.ok === true && !JSON.stringify(wl).includes('hook.test'), 'POST webhook_last 도 읽힌다(주소 없음)');
  delete S.props.WEBHOOK_TRIGGERS_JSON;
}

console.log('\n21) 👀 이모지 반응 — queue_react · 자동 「전달됨 ✓」 · 브리핑 전달됨/접수 (2026-11-26)');
{
  const KR = S.props.SECRET_KEY;
  const SH = 'SHEETidReact2101';
  const HEADR = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const now = S.sb.Date.now();
  const iso = ms => new Date(ms).toISOString();
  const mkR = (id, ago, source, payload, status) => {
    const row = new Array(HEADR.length).fill('');
    row[HEADR.indexOf('id')] = id; row[HEADR.indexOf('created_at')] = iso(now - ago * 60000);
    row[HEADR.indexOf('source')] = source; row[HEADR.indexOf('type')] = 'claude_prompt';
    row[HEADR.indexOf('payload')] = JSON.stringify(payload); row[HEADR.indexOf('status')] = status || 'PENDING';
    return row;
  };
  const chat = (target, prompt) => ({ prompt, mode: 'ask', kind: 'chat', target });
  S.addSheet(SH, { 'Command_Queue': [HEADR.slice(0),
    mkR('Q-r1', 90, 'pi1', chat('vooy', '@부이 비교표 부탁')),
    mkR('Q-r2', 80, 'portal', chat('vooy', '@부이 체크리스트')),
    mkR('Q-r3', 70, 'portal', chat('all', '@전체 상태 알려줘')),
    mkR('Q-r4', 60, 'portal', { prompt: '가계부 점검', mode: 'ask' }),
    mkR('Q-r5', 50, 'portal', chat('keyring', '@키링 기차표 봐줘'))
  ] });
  S.props.QUEUE_SHEET_ID = SH;
  const react = (as, id, emoji) => post({ action: 'queue_react', key: KR, as, id, emoji });
  const rowOf = id => S.books[SH]['Command_Queue'].find(r => r[0] === id) || [];
  const st = id => rowOf(id)[HEADR.indexOf('status')];
  const rx = () => S.books[SH]['Reactions'] || null;
  const listItem = id => post({ action: 'queue_list', key: KR, limit: 20 }).items.find(x => x.id === id) || {};

  // ⓪ 읽기는 탭을 만들지 않는다 · 시트 22칸은 그대로
  post({ action: 'queue_list', key: KR, limit: 5 });
  ok(rx() === null, '반응이 없으면 queue_list 가 Reactions 탭을 만들지 않는다');
  ok(S.books[SH]['Command_Queue'][0].length === 22, 'Command_Queue 22칸은 건드리지 않는다');

  // ① 입력 검사
  ok(post({ action: 'queue_react', key: KR, id: 'Q-r1', emoji: '👀' }).ok === false, 'as 없으면 거절');
  ok(react('portal', 'Q-r1', '👀').ok === false, 'as=portal 은 거절');
  ok(react('vooy', '', '👀').ok === false, 'id 없으면 거절');
  ok(react('vooy', 'Q-r1', '😂').ok === false && react('vooy', 'Q-r1', '').ok === false, '정해진 이모지 밖은 거절');
  ok(react('vooy', 'Q-nope', '👀').ok === false, '없는 오더는 거절');
  ok(post({ action: 'queue_react', key: 'x'.repeat(64), as: 'vooy', id: 'Q-r1', emoji: '👀' }).error === 'unauthorized', '키 없이는 거절');
  ok(rx() === null, '거절된 호출은 아무것도 남기지 않는다');

  // ② 👀 접수 — 상태는 그대로, 반응만 남는다
  let r1 = react('vooy', 'Q-r1', 'seen');
  ok(r1.ok === true && r1.emoji === '👀' && r1.added === true && r1.effect === '' && r1.status === 'PENDING', '별칭 seen → 👀 · 상태는 그대로');
  ok(rx() && JSON.stringify(rx()[0]) === JSON.stringify(['at', 'order_id', 'agent', 'emoji']) && rx().length === 2, '첫 반응에서 Reactions 탭과 머리글이 생긴다');
  ok(react('vooy', 'Q-r1', '👀').added === false && rx().length === 2, '같은 반응은 두 번 쌓이지 않는다');
  const li = listItem('Q-r1');
  ok(Array.isArray(li.reactions) && li.reactions.length === 1 && li.reactions[0].by === 'vooy' && li.reactions[0].e === '👀', 'queue_list 항목에 reactions 가 실린다');
  ok(!JSON.stringify(rx()).includes('비교표'), '반응 탭에는 본문이 남지 않는다');

  // ③ 🔧 진행 중 — 반응만(2026-11-27): RUNNING 으로 집으면 노트북 워커 20분 타임아웃(TIMEOUT_REVIEW)에 걸린다
  r1 = react('vooy', 'Q-r1', '🔧');
  ok(r1.ok === true && r1.effect === '' && r1.status === 'PENDING' && st('Q-r1') === 'PENDING' && rowOf('Q-r1')[HEADR.indexOf('claimed_by')] === '', '🔧 은 반응만 남기고 상태는 그대로(PENDING) — 워커 타임아웃에 안 걸린다');
  // ④ ✅ 완료 — 확인 답장을 대신해 닫는다
  r1 = react('vooy', 'Q-r1', '✅');
  ok(r1.effect === 'closed' && st('Q-r1') === 'DONE' && rowOf('Q-r1')[HEADR.indexOf('result')] === '✅ 완료', '✅ 은 내 말을 DONE 으로 닫고 결과칸에 ✅ 완료');
  ok(react('vooy', 'Q-r1', '✅').added === false && st('Q-r1') === 'DONE', '이미 닫힌 말에 다시 눌러도 그대로');
  // ⑤ 주인이 아니면 반응만
  const r2a = react('pi2', 'Q-r2', '✅');
  ok(r2a.ok === true && r2a.effect === '' && st('Q-r2') === 'PENDING', '주인(받는 비서)이 아니면 ✅ 로도 닫히지 않는다 — 반응만 남는다');
  // ⑥ 🙅 내 일 아님
  const r2b = react('vooy', 'Q-r2', '🙅');
  ok(r2b.effect === 'closed' && st('Q-r2') === 'DONE' && /내 일 아님/.test(rowOf('Q-r2')[HEADR.indexOf('result')]), '🙅 은 내 앞 말을 닫고 결과칸에 내 일 아님');
  // ⑦ @전체·노트북 앞은 반응만
  ok(react('cue', 'Q-r3', '✅').effect === '' && st('Q-r3') === 'PENDING', '@전체 말은 한 명이 ✅ 해도 닫히지 않는다');
  ok(react('notebook', 'Q-r4', '✅').effect === '' && st('Q-r4') === 'PENDING', '노트북 앞 실행 오더는 반응으로 닫히지 않는다');
  ok(react('pi1', 'Q-r4', '🔧').effect === '' && st('Q-r4') === 'PENDING', '노트북 오더는 다른 비서가 🔧 로 가로채지 못한다');

  // ⑧ 자동 「전달됨 ✓」 — 비서가 아무것도 안 해도, 받은편지함으로 가져가면 서버가 남긴다
  let ib = post({ action: 'queue_inbox', key: KR, as: 'keyring' });
  ok(ib.ok === true && ib.items.some(x => x.id === 'Q-r5') && ib.delivered_mark === true, '키링이 받은편지함으로 가져간다');
  const deliv = () => (rx() || []).filter(r => r[1] === 'Q-r5' && r[2] === 'keyring' && r[3] === '✓').length;
  ok(deliv() === 1, '가져간 말에 「전달됨 ✓」 이 자동으로 한 번 남는다');
  ok(ib.items.find(x => x.id === 'Q-r5').reactions.some(x => x.by === 'keyring' && x.e === '✓'), '응답 항목에도 전달됨이 보인다');
  post({ action: 'queue_inbox', key: KR, as: 'keyring' });
  ok(deliv() === 1, '다시 가져가도 전달됨이 쌓이지 않는다');
  ok((rx() || []).filter(r => r[1] === 'Q-r2' && r[3] === '✓').length === 0, '이미 닫힌 말·반응이 있는 말에는 ✓ 가 없다');
  const cl = post({ action: 'queue_claim', key: KR, as: 'keyring', id: 'Q-r5' });
  ok(cl.ok === true && cl.changed === true && (rx() || []).some(r => r[1] === 'Q-r5' && r[2] === 'keyring' && r[3] === '🔧'), 'queue_claim 으로 집으면 🔧 반응도 남는다');

  // ⑧-2 지금 비서들이 쓰는 읽기(queue_list target=내id)에도 전달됨이 자동으로 — 비서 수정 없이 효과가 난다
  S.addSheet('SHEETidReact2103', { 'Command_Queue': [HEADR.slice(0),
    mkR('Q-t1', 30, 'pi1', chat('keyring2', '@키투 하나')), mkR('Q-t2', 20, 'pi1', chat('all', '@전체 둘')), mkR('Q-t3', 10, 'pi1', chat('cue', '@큐 셋'))] });
  S.props.QUEUE_SHEET_ID = 'SHEETidReact2103';
  ok(S.books['SHEETidReact2103']['Reactions'] === undefined, '(준비) 반응 탭 없음');
  post({ action: 'queue_list', key: KR, limit: 20 });
  ok(S.books['SHEETidReact2103']['Reactions'] === undefined, 'target 없이 읽으면(포털·폰 앱) 전달됨이 찍히지 않는다');
  const tl = JSON.parse(S.sb.doGet({ parameter: { action: 'queue_list', key: KR, target: 'keyring2', limit: 20 } }).getContent());
  const tdel = (S.books['SHEETidReact2103']['Reactions'] || []).filter(r => r[3] === '✓');
  ok(tdel.length === 1 && tdel[0][1] === 'Q-t1' && tdel[0][2] === 'keyring2', 'GET queue_list target=keyring2 — 내 앞 PENDING 에만 ✓ 한 줄(@전체·남의 말에는 없다)');
  ok(tl.items.find(x => x.id === 'Q-t1').reactions.some(x => x.by === 'keyring2' && x.e === '✓'), '응답 항목에도 전달됨이 보인다');
  JSON.parse(S.sb.doGet({ parameter: { action: 'queue_list', key: KR, target: 'keyring2', limit: 20 } }).getContent());
  ok((S.books['SHEETidReact2103']['Reactions'] || []).filter(r => r[3] === '✓').length === 1, '다시 읽어도 쌓이지 않는다');
  ok(JSON.parse(S.sb.doGet({ parameter: { action: 'queue_list', key: KR, target: 'portal', limit: 20 } }).getContent()).ok === true && (S.books['SHEETidReact2103']['Reactions'] || []).filter(r => r[2] === 'portal').length === 0, 'target=portal(사람)은 전달됨을 남기지 않는다');
  S.props.QUEUE_SHEET_ID = SH;

  // ⑨ 브리핑 — 안 읽음을 미전달 / 전달됨 / 접수로 가른다 + 접수까지 걸린 시간
  const SB2 = 'SHEETidReact2102';
  S.addSheet(SB2, { 'Command_Queue': [HEADR.slice(0),
    mkR('Q-s1', 70, 'pi1', chat('vooy2', '@뷔투 일 하나')),
    mkR('Q-s2', 50, 'pi1', chat('vooy2', '@뷔투 일 둘')),
    mkR('Q-s3', 40, 'pi1', chat('vooy2', '@뷔투 일 셋'))
  ], 'Reactions': [['at', 'order_id', 'agent', 'emoji'], [iso(now - 30 * 60000), 'Q-s2', 'vooy2', '✓']] });
  S.props.QUEUE_SHEET_ID = SB2;
  ok(react('vooy2', 'Q-s3', '👀').ok === true, '뷔투가 셋째 말에 👀');
  const bb = post({ action: 'queue_brief', key: KR });
  const v2 = (bb.agents || []).find(a => a.id === 'vooy2') || {};
  ok(v2.unread === 3 && v2.undelivered === 1 && v2.delivered === 1 && v2.seen === 1, '뷔투: 안 읽음 3 = 미전달 1 · 전달됨 1 · 접수 1');
  ok(v2.pickup_n === 2 && v2.pickup_med_min === 40, '접수까지 걸린 시간 중간값(분) — 근거가 있는 말만 센다');
  ok(bb.totals.undelivered === 1 && bb.totals.delivered === 1 && bb.totals.seen === 1, '합계에도 같은 3분류');
  ok(v2.oldest_undelivered && v2.oldest_undelivered.id === 'Q-s1' && v2.oldest_undelivered.from === 'pi1', '가장 오래 미전달된 말(빨강 판정의 근거)');
  const pk = (bb.agents || []).find(a => a.id === 'pi1') || {};
  ok(pk.pickup_med_min === null && pk.pickup_n === 0, '반응 근거가 없으면 null — 지어내지 않는다');
  S.props.QUEUE_SHEET_ID = SH;
}

console.log('\n22) 🧹 묵은 대화 정리 — queue_sweep (미리보기 기본 · 안전한 두 갈래만) (2026-11-26)');
{
  const KW = S.props.SECRET_KEY;
  const SW = 'SHEETidSweep2201';
  const HEADW = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const now = S.sb.Date.now();
  const iso = ms => new Date(ms).toISOString();
  const mkW = (id, hoursAgo, source, payload, status) => {
    const row = new Array(HEADW.length).fill('');
    row[HEADW.indexOf('id')] = id; row[HEADW.indexOf('created_at')] = iso(now - hoursAgo * 3600000);
    row[HEADW.indexOf('source')] = source; row[HEADW.indexOf('type')] = 'claude_prompt';
    row[HEADW.indexOf('payload')] = JSON.stringify(payload); row[HEADW.indexOf('status')] = status || 'PENDING';
    return row;
  };
  const chat = (target, prompt, x) => Object.assign({ prompt, mode: 'ask', kind: 'chat', target }, x || {});
  S.addSheet(SW, {
    'Command_Queue': [HEADW.slice(0),
      mkW('Q-w1', 30, 'pi1', chat('cue', '@큐 일정 전담 맡아줘')),                       // 큐가 답함 → answered
      mkW('Q-w2', 29, 'cue', chat('portal', '맡을게요 — 내일부터', { reply_to: 'Q-w1' }), 'DONE'),
      mkW('Q-w3', 25, 'portal', chat('vooy', '@부이 오래된 요청')),                         // 오래됐고 접수 없음 → stale
      mkW('Q-w4', 24, 'portal', chat('vooy2', '@뷔투 오래됐지만 접수함')),                  // 👀 접수 → 안 건드림
      mkW('Q-w5', 2, 'portal', chat('keyring', '@키링 방금 온 말')),                        // 신선 → 안 건드림
      mkW('Q-w6', 40, 'portal', chat('all', '@전체 오래된 공지')),                          // @전체 → 안 건드림
      mkW('Q-w7', 40, 'portal', { prompt: '가계부 점검', mode: 'ask' }),                    // 노트북 앞 실행 오더 → 안 건드림
      mkW('Q-w8', 40, 'portal', chat('notebook', '@노트북 오래된 말')),                     // 노트북 앞 대화 → 안 건드림
      mkW('Q-w9', 40, 'pi1', chat('portal', '사람 앞 오래된 말')),                          // 사람 앞 → 안 건드림
      mkW('Q-wa', 40, 'portal', chat('keyring2', '@키투 오래됐고 아무 반응 없음')),           // stale
      mkW('Q-wb', 40, 'portal', chat('pi2', '@피투 오래됐지만 승인 대기'), 'WAITING_APPROVAL') // 승인 대기 → 안 건드림
    ],
    'Reactions': [['at', 'order_id', 'agent', 'emoji'], [iso(now - 23 * 3600000), 'Q-w4', 'vooy2', '👀'], [iso(now - 30 * 3600000), 'Q-w3', 'vooy', '✓']]
  });
  S.props.QUEUE_SHEET_ID = SW;
  const sweep = x => post(Object.assign({ action: 'queue_sweep', key: KW }, x || {}));
  const rowW = id => S.books[SW]['Command_Queue'].find(r => r[0] === id) || [];
  const stW = id => rowW(id)[HEADW.indexOf('status')];
  const before = JSON.stringify(S.books[SW]['Command_Queue']);

  // ① 미리보기가 기본 — 아무것도 바꾸지 않는다
  let pv = sweep();
  ok(pv.ok === true && pv.apply === false && /미리보기/.test(pv.note || ''), '기본은 미리보기');
  ok(pv.answered === 1 && pv.stale === 2 && pv.broadcast === 1 && pv.plan === 4, '닫을 후보: 답장됨 1 + 미접수 2 + 예전 @전체 공지 1');
  ok(JSON.stringify(S.books[SW]['Command_Queue']) === before, '미리보기는 시트를 하나도 안 바꾼다');
  ok(!S.books[SW]['Audit_Log'], '미리보기는 감사 로그도 안 남긴다');
  const ids = pv.items.map(x => x.id).sort().join(',');
  ok(ids === 'Q-w1,Q-w3,Q-w6,Q-wa', '후보 = 답장된 말(w1) · 접수 없는 묵은 말(w3, ✓ 전달됨만 있음) · 예전 @전체 공지(w6) · 반응 없는 묵은 말(wa)');
  ok(pv.items.every(x => typeof x.text === 'string' && x.text.length <= 70 && x.age_h >= 0), '후보마다 한 줄 요약(70자)·나이');
  ok(pv.by_agent.cue.answered === 1 && pv.by_agent.vooy.stale === 1 && pv.by_agent.keyring2.stale === 1, '비서별 집계');
  ok(sweep({ apply: 'no' }).apply === false && sweep({ apply: 1 }).apply === false, 'apply 는 true 일 때만(다른 값은 미리보기)');
  ok(post({ action: 'queue_sweep', key: 'x'.repeat(64) }).error === 'unauthorized', '키 없이는 거절');

  // ② 나이 기준 — 6~168시간으로 고정, 더 짧게 못 준다
  ok(sweep({ min_age_hours: 1 }).min_age_hours === 6 && sweep({ min_age_hours: 9999 }).min_age_hours === 168, '기준은 6~168시간으로 묶인다');
  ok(sweep({ min_age_hours: 48 }).stale === 0, '48시간 기준이면 미접수 묵은 말이 없다(가장 오래된 게 40시간)');

  // ③ 실제로 닫기
  const ap = sweep({ apply: true });
  ok(ap.ok === true && ap.apply === true && ap.applied === 4 && ap.remaining === 0, 'apply 로 4건을 닫는다');
  ok(stW('Q-w1') === 'DONE' && rowW('Q-w1')[HEADW.indexOf('claimed_by')] === 'cue' && rowW('Q-w1')[HEADW.indexOf('result')] === '↩ 답장 Q-w2', '답장된 말은 DONE · 처리자 · 결과칸 ↩ 답장 <id>');
  ok(stW('Q-w3') === 'EXPIRED' && /정리/.test(rowW('Q-w3')[HEADW.indexOf('error')]) && rowW('Q-w3')[HEADW.indexOf('result')] === '', '미접수 묵은 말은 DONE 이 아니라 EXPIRED — 사유는 error 에, 결과칸은 비어 있다');
  ok(stW('Q-wa') === 'EXPIRED', '반응 없는 묵은 말도 EXPIRED');
  // ④ 건드리면 안 되는 것
  ok(stW('Q-w4') === 'PENDING', '접수(👀)한 말은 오래돼도 안 닫는다');
  ok(stW('Q-w5') === 'PENDING', '신선한 말은 안 닫는다');
  ok(stW('Q-w6') === 'DONE' && /전달됨/.test(rowW('Q-w6')[HEADW.indexOf('result')]), '예전 @전체 공지는 "전달됨"으로 닫는다(실행 안 한 게 아니라 전달 끝)');
  ok(stW('Q-w7') === 'PENDING', '실행 오더(비-chat)는 안 닫는다');
  ok(stW('Q-w8') === 'PENDING', '노트북 앞 대화는 안 닫는다');
  ok(stW('Q-w9') === 'PENDING', '사람(포털) 앞 말은 안 닫는다');
  ok(stW('Q-wb') === 'WAITING_APPROVAL', '승인 대기는 안 건드린다');
  ok(S.books[SW]['Audit_Log'] && S.books[SW]['Audit_Log'].some(r => r.indexOf('sweep') >= 0), '감사 로그에 정리 한 줄');
  // ⑤ 다시 불러도 더 닫을 게 없다
  const again = sweep({ apply: true });
  ok(again.applied === 0 && again.plan === 0, '두 번째 apply 는 할 일이 없다(멱등)');
  // ⑥ 한 번에 limit 건 — 남으면 remaining
  const many = [HEADW.slice(0)];
  for (let i = 0; i < 5; i++) many.push(mkW('Q-m' + i, 30, 'portal', chat('vooy', '@부이 묵은 ' + i)));
  S.addSheet('SHEETidSweep2202', { 'Command_Queue': many });
  S.props.QUEUE_SHEET_ID = 'SHEETidSweep2202';
  const lim = sweep({ apply: true, limit: 2 });
  ok(lim.applied === 2 && lim.remaining === 3 && lim.plan === 5, 'limit 만큼만 닫고 남은 수를 알린다');
  ok(sweep({ apply: true, limit: 99 }).applied === 3, '한 번 더 부르면 나머지를 닫는다');
  // ⑦ 브리핑에서 안 읽음이 줄어든다
  const br = post({ action: 'queue_brief', key: KW });
  ok(br.ok === true && (br.agents.find(a => a.id === 'vooy') || {}).unread === 0, '정리 뒤 브리핑의 안 읽음이 0');
  S.props.QUEUE_SHEET_ID = SW;
}

console.log('\n23) 🩹 어제 실측 회귀 3건 — TIMEOUT_REVIEW 닫기 · 출처 오기 · 🔧 충돌 (2026-11-27)');
{
  const KT = S.props.SECRET_KEY;
  const ST = 'SHEETidFix2301';
  const HEADT = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const now = S.sb.Date.now();
  const iso = ms => new Date(ms).toISOString();
  const mkT = (id, hoursAgo, source, payload, status, extra) => {
    const row = new Array(HEADT.length).fill('');
    row[HEADT.indexOf('id')] = id; row[HEADT.indexOf('created_at')] = iso(now - hoursAgo * 3600000);
    row[HEADT.indexOf('source')] = source; row[HEADT.indexOf('type')] = 'claude_prompt';
    row[HEADT.indexOf('payload')] = JSON.stringify(payload); row[HEADT.indexOf('status')] = status || 'PENDING';
    Object.keys(extra || {}).forEach(k => { const i = HEADT.indexOf(k); if (i >= 0) row[i] = extra[k]; });
    return row;
  };
  const chat = (target, prompt, x) => Object.assign({ prompt, mode: 'ask', kind: 'chat', target }, x || {});
  const TIMEOUT_ERR = '응답 없음(20분) · 재실행하지 않았습니다 — claude_prompt 은(는) 두 번 돌리면 결과가 중복될 수 있습니다.';
  S.addSheet(ST, { 'Command_Queue': [HEADT.slice(0),
    mkT('Q-f1', 20, 'pi2', chat('vooy2', '【@뷔투 개선 일감 ④】 SEO 개선안'), 'TIMEOUT_REVIEW', { claimed_by: 'vooy2', claimed_at: iso(now - 19 * 3600000), error: TIMEOUT_ERR }),
    mkT('Q-f2', 20, 'pi1', chat('vooy2', '@뷔투 또 하나'), 'TIMEOUT_REVIEW', { claimed_by: 'vooy2', claimed_at: iso(now - 19 * 3600000), error: TIMEOUT_ERR }),
    mkT('Q-f3', 20, 'pi1', chat('vooy2', '@뷔투 답 안 한 격리 건'), 'TIMEOUT_REVIEW', { claimed_by: 'vooy2', error: TIMEOUT_ERR }),
    mkT('Q-f4', 20, 'pi1', { prompt: '가계부 점검', mode: 'ask' }, 'TIMEOUT_REVIEW', { claimed_by: 'notebook', error: TIMEOUT_ERR }),
    mkT('Q-f5', 3, 'pi1', chat('keyring2', '@키투 블로그 수정 인계'))
  ] });
  S.props.QUEUE_SHEET_ID = ST;
  const row = id => S.books[ST]['Command_Queue'].find(r => r[0] === id) || [];
  const col = (id, k) => row(id)[HEADT.indexOf(k)];
  const enq = (source, payload, extra) => post(Object.assign({ action: 'queue_enqueue', key: KT, type: 'claude_prompt', workspace: 'gaegyebu', source, payload }, extra || {}));

  // ① 집은 비서의 답장은 TIMEOUT_REVIEW 도 닫는다 — 에러 문구도 지운다
  const e1 = enq('vooy2', chat('pi2', '[뷔투 보고] 1. 프로젝트: 묘한살림 SEO — 완료', { reply_to: 'Q-f1' }));
  ok(e1.ok === true && e1.closed && e1.closed.id === 'Q-f1' && e1.closed.by === 'vooy2', '집은 비서(뷔투)가 답장하면 TIMEOUT_REVIEW 원글이 닫힌다');
  ok(col('Q-f1', 'status') === 'DONE' && col('Q-f1', 'error') === '' && String(col('Q-f1', 'result')).indexOf('↩ 답장') === 0, 'DONE · "응답 없음" 문구 제거 · 결과칸 ↩ 답장');
  const e1b = enq('pi2', chat('portal', '대신 답해요', { reply_to: 'Q-f2' }));
  ok(!e1b.closed && col('Q-f2', 'status') === 'TIMEOUT_REVIEW', '집은 비서가 아닌 다른 비서의 답장은 닫지 않는다');
  const e1c = enq('pi2', chat('portal', '노트북 건 답', { reply_to: 'Q-f4' }));
  ok(!e1c.closed && col('Q-f4', 'status') === 'TIMEOUT_REVIEW', '노트북이 집은 TIMEOUT_REVIEW 는 건드리지 않는다');

  // ② 정리(sweep) — 집은 비서가 답한 TIMEOUT_REVIEW 만 닫고, 답 없는 것·노트북 것은 그대로
  enq('vooy2', chat('pi1', '[뷔투 보고] 또 하나 끝', { reply_to: 'Q-f2' }));
  const sw0 = post({ action: 'queue_sweep', key: KT });
  ok(sw0.apply === false && sw0.stale === 0, '미리보기 — Q-f2 는 이미 위 답장으로 닫혔다');
  S.books[ST]['Command_Queue'].find(r => r[0] === 'Q-f2')[HEADT.indexOf('status')] = 'TIMEOUT_REVIEW';   // (시험용) 닫기 전 상태로 되돌린다
  const sw = post({ action: 'queue_sweep', key: KT });
  ok(sw.answered === 1 && sw.items[0].id === 'Q-f2', '정리 후보: 집은 비서가 답한 TIMEOUT_REVIEW 1건');
  ok(col('Q-f3', 'status') === 'TIMEOUT_REVIEW' && !sw.items.some(x => x.id === 'Q-f3'), '답이 없는 격리 건은 후보가 아니다(stale 로도 안 닫는다 — 결과 미확인)');
  const swA = post({ action: 'queue_sweep', key: KT, apply: true });
  ok(swA.applied === 1 && col('Q-f2', 'status') === 'DONE' && col('Q-f2', 'error') === '', 'apply 하면 닫고 에러 문구를 지운다');
  ok(col('Q-f4', 'status') === 'TIMEOUT_REVIEW', '노트북이 집은 건 정리에서도 그대로');

  // ③ 출처 오기 — 명시한 source 가 portal 이어도 그 비서의 이름표로 시작하는 답장이면 그 비서
  const m1 = enq('portal', chat('portal', '[키투 보고] 레이 님, 재알림 확인했습니다. 현재 로그인 대기 상태입니다.', { reply_to: 'Q-f5' }));
  ok(m1.ok === true && m1.item.source === 'keyring2', "source:'portal' 로 와도 [키투 …] 로 시작하고 원글이 키투 앞이면 키투의 말로 기록한다");
  const m2 = enq('portal', chat('keyring2', '키투야 상황 어때?', { reply_to: 'Q-f5' }));
  ok(m2.item.source === 'portal', '진짜 레이 님 말(이름표 없음)은 그대로 portal');
  const m3 = enq('portal', chat('portal', '[뷔투 보고] 다른 비서 이름표', { reply_to: 'Q-f5' }));
  ok(m3.item.source === 'portal', '원글을 받은 비서(키투)와 다른 이름표는 인정하지 않는다');
  const m4 = enq('portal', chat('portal', '[키투 보고] 원글 없는 말'));
  ok(m4.item.source === 'portal', 'reply_to 가 없으면 이름표만으로는 바꾸지 않는다');
  const m5 = enq('cue', chat('portal', '[키투 보고] 큐가 쓴 말', { reply_to: 'Q-f5' }));
  ok(m5.item.source === 'cue', '명시한 source 가 비서면 그대로(이름표로 덮지 않는다)');
  ok(post({ action: 'queue_list', key: KT, limit: 5 }).items.some(x => x.id === m1.item.id && x.source === 'keyring2'), '목록에도 키투로 보인다');

  // ④ 규칙 문구에 침묵·claim 주의가 들어간다
  ok(/침묵이 정답/.test(m1.report_rule || '') && /queue_claim 으로 집지 마세요/.test(m1.report_rule || '') && /응답 없음/.test(m1.report_rule || ''), 'report_rule 에 침묵·20분 격리 주의가 있다');
  S.props.QUEUE_SHEET_ID = 'SHEETidReact2101';
}

console.log('\n24) 🔔 승인함 — kind:approval · approval_list · approval_decide (2026-11-27)');
{
  const KA = S.props.SECRET_KEY;
  const SA = 'SHEETidAppr2401';
  const HEADA = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const now = S.sb.Date.now();
  const iso = ms => new Date(ms).toISOString();
  const mkA = (id, hoursAgo, source, payload, status, extra) => {
    const row = new Array(HEADA.length).fill('');
    row[HEADA.indexOf('id')] = id; row[HEADA.indexOf('created_at')] = iso(now - hoursAgo * 3600000);
    row[HEADA.indexOf('source')] = source; row[HEADA.indexOf('type')] = 'claude_prompt'; row[HEADA.indexOf('workspace')] = 'gaegyebu';
    row[HEADA.indexOf('payload')] = JSON.stringify(payload); row[HEADA.indexOf('status')] = status || 'PENDING';
    Object.keys(extra || {}).forEach(k => { const i = HEADA.indexOf(k); if (i >= 0) row[i] = extra[k]; });
    return row;
  };
  const chat = (target, prompt, x) => Object.assign({ prompt, mode: 'ask', kind: 'chat', target }, x || {});
  S.addSheet(SA, { 'Command_Queue': [HEADA.slice(0),
    mkA('Q-a1', 3, 'vooy2', chat('portal', '묘한살림 상품명 3안 정리했어요. 1안으로 진행해도 될까요?')),          // 승인 묻는 대화 → suggested
    mkA('Q-a2', 3, 'pi1', chat('portal', '오늘 블로그 통계 정리 끝났어요.'), 'DONE'),                           // 그냥 보고 → 안 모음
    mkA('Q-a3', 60, 'pi2', chat('portal', '스토어 배포 승인 요청드립니다')),                                     // 48시간 넘음 → 안 모음
    mkA('Q-a4', 2, 'portal', { prompt: '포털 코드 고쳐', mode: 'edit' }, 'WAITING_APPROVAL',
      { risk_level: 'HIGH', approval_expires_at: iso(now + 10 * 60000) }),                                    // 실행 승인 대기 → order
    mkA('Q-a5', 2, 'cue', chat('portal', '결제 승인 부탁드려요')),                                               // suggested 인데 레이 님이 답장함 → 빠짐
    mkA('Q-a6', 1, 'portal', chat('cue', '그건 하지 마', { reply_to: 'Q-a5' }), 'PENDING')
  ] });
  S.props.QUEUE_SHEET_ID = SA;
  const rowA = id => S.books[SA]['Command_Queue'].find(r => r[0] === id) || [];
  const colA = (id, k) => rowA(id)[HEADA.indexOf(k)];
  const list = () => post({ action: 'approval_list', key: KA });

  // ① 비서의 승인 요청 — kind:'approval'
  const req = post({ action: 'queue_enqueue', key: KA, type: 'claude_prompt', source: 'keyring2',
    payload: { kind: 'approval', target: 'cue', title: '네이버 블로그 임시저장 글 2건 수정', prompt: '임시저장 2건을 2줄 호흡 구어체로 고칩니다(발행은 안 함).\n안 하면 이번 주 업로드가 밀려요.', risk: '외부 계정', ref: 'Q-a2', due: '오늘 18시' } });
  ok(req.ok === true && req.item.kind === 'approval' && req.item.target === 'portal' && req.item.status === 'PENDING', '승인 요청은 대상을 portal 로 고정하고 PENDING 으로 남는다(결정 전까지)');
  ok(req.item.workspace !== '' && req.item.needs_decision === true, '작업 위치를 안 줘도 받고, needs_decision=true');
  ok(req.item.approval && req.item.approval.request === true && req.item.approval.title === '네이버 블로그 임시저장 글 2건 수정' && req.item.approval.risk === '외부 계정' && req.item.approval.ref === 'Q-a2' && req.item.approval.due === '오늘 18시', '제목·위험 종류·관련 오더·기한이 실린다');
  ok(String(req.item.summary).indexOf('[워커 규칙]') < 0 && /발행은 안 함/.test(req.item.summary), '워커 규칙 문구를 붙이지 않고 본문 그대로');
  const reqNoTitle = post({ action: 'queue_enqueue', key: KA, type: 'claude_prompt', workspace: 'gaegyebu', source: 'vooy',
    payload: { kind: 'approval', prompt: '쿠팡 광고비 3만원 결제 승인 부탁드려요\n효과 측정은 7일' } });
  ok(reqNoTitle.ok === true && reqNoTitle.item.approval.title === '쿠팡 광고비 3만원 결제 승인 부탁드려요', '제목이 없으면 본문 첫 줄');
  ok(/kind:"approval"|kind:\\"approval\\"|approval/.test(req.report_rule || '') && /다른 앱/.test(req.report_rule || ''), 'report_rule 에 승인은 회의실로만 규칙이 있다');
  // 노트북·비서가 집어 가지 않는다
  const clA = post({ action: 'queue_claim', key: KA, as: 'keyring2' });
  ok(clA.ok === true && (!clA.item || clA.item.id !== req.item.id), '승인 요청은 비서가 집어 가지 않는다(요청한 비서도 — 대상은 portal)');

  // ② 승인함 — request · order · suggested
  let L = list();
  const ids = L.items.map(x => x.id);
  ok(L.ok === true && L.counts.request === 2 && L.counts.order === 1 && L.counts.suggested === 1 && L.count === 4, '승인함: 요청 2 · 실행 승인 1 · 승인 묻는 대화 1');
  ok(ids.indexOf('Q-a1') >= 0 && ids.indexOf('Q-a4') >= 0 && ids.indexOf(req.item.id) >= 0, '세 갈래가 다 모인다');
  ok(ids.indexOf('Q-a2') < 0 && ids.indexOf('Q-a3') < 0 && ids.indexOf('Q-a5') < 0, '그냥 보고·48시간 지난 말·이미 답장한 말은 안 모은다');
  ok(L.items.find(x => x.id === 'Q-a1').approval_kind === 'suggested' && L.items.find(x => x.id === 'Q-a4').approval_kind === 'order', '갈래 표시(approval_kind)');
  const gl = JSON.parse(S.sb.doGet({ parameter: { action: 'approval_list', key: KA } }).getContent());
  ok(gl.ok === true && gl.count === L.count, 'GET approval_list 도 읽힌다');
  ok(post({ action: 'approval_list' }).error === 'unauthorized', '키 없으면 거절');

  // ③ 결정 — 승인 → DONE + 요청한 비서에게 답장
  const n0 = S.books[SA]['Command_Queue'].length;
  let d = post({ action: 'approval_decide', key: KA, id: req.item.id, decision: 'approve', note: '발행은 절대 금지' });
  ok(d.ok === true && d.changed === true && d.status === 'DONE' && d.requester === 'keyring2' && !!d.reply_id, '승인 → DONE · 요청한 키투에게 답장');
  ok(colA(req.item.id, 'approval_by') === 'portal' && /^✅ 승인 — 발행은 절대 금지/.test(colA(req.item.id, 'approval_note')) && !!colA(req.item.id, 'approval_at'), '결정 기록(approval_by·at·note)');
  const reply = rowA(d.reply_id); const rp = JSON.parse(reply[HEADA.indexOf('payload')] || '{}');
  ok(S.books[SA]['Command_Queue'].length === n0 + 1 && reply[HEADA.indexOf('source')] === 'portal' && rp.target === 'keyring2' && rp.reply_to === req.item.id && /✅ 승인/.test(rp.prompt) && /발행은 절대 금지/.test(rp.prompt), '답장: portal → 키투 · reply_to=요청 · 결정과 메모');
  ok(post({ action: 'approval_decide', key: KA, id: req.item.id, decision: 'reject' }).changed === false, '이미 결정한 요청은 다시 바꾸지 않는다');
  // 보류 → PENDING 유지, 승인함에 '보류'로 남는다(맨 뒤)
  d = post({ action: 'approval_decide', key: KA, id: reqNoTitle.item.id, decision: 'hold', note: '다음 주에' });
  ok(d.ok === true && colA(reqNoTitle.item.id, 'status') === 'PENDING' && /^⏸ 보류/.test(colA(reqNoTitle.item.id, 'approval_note')), '보류 → 상태는 PENDING 그대로, 기록만');
  L = list();
  const held = L.items.find(x => x.id === reqNoTitle.item.id);
  ok(held && held.held === true && L.items[L.items.length - 1].id === reqNoTitle.item.id && L.counts.held === 1, '보류한 요청은 승인함 맨 뒤에 보류로 남는다');
  d = post({ action: 'approval_decide', key: KA, id: reqNoTitle.item.id, decision: 'reject', note: '예산 없음' });
  ok(d.changed === true && colA(reqNoTitle.item.id, 'status') === 'REJECTED' && /^🚫 거절 — 예산 없음/.test(colA(reqNoTitle.item.id, 'error')), '보류했던 요청도 나중에 거절할 수 있다 → REJECTED');
  // 승인 묻는 대화 — 상태는 그대로, 기록만 하고 승인함에서 빠진다
  d = post({ action: 'approval_decide', key: KA, id: 'Q-a1', decision: 'approve' });
  ok(d.ok === true && d.kind === 'suggested' && colA('Q-a1', 'status') === 'PENDING' && /^✅ 승인/.test(colA('Q-a1', 'approval_note')), '대화형 승인 질문도 결정할 수 있다(상태는 그대로)');
  // 실행 승인 대기 — 기존 queue_decide 길로
  ok(post({ action: 'approval_decide', key: KA, id: 'Q-a4', decision: 'hold' }).ok === false, '실행 승인은 보류할 수 없다');
  d = post({ action: 'approval_decide', key: KA, id: 'Q-a4', decision: 'approve' });
  ok(d.ok === true && d.kind === 'order' && colA('Q-a4', 'status') === 'PENDING', '실행 승인은 queue_decide 와 같은 길로 PENDING(노트북 실행 차례)');
  L = list();
  ok(L.count === 0 && L.items.length === 0, '결정하고 나면 승인함이 빈다');
  // 자동 감지 — 2026-11-27 실측 6건으로 보정: 요청 형태만, 부정·약속 문장은 뺀다
  const H = s => S.sb.qqApprovalHint_(s);
  ok(H('키링 주기 변경은 키링 앱에서 성래 님 승인이 필요합니다. 나머지는 끝') === true, '진짜: 승인이 필요합니다(문장 끝)');
  ok(H('GAS 재배포 및 레이 님 OAuth 1회 재승인 필요. 고해상도는 병행') === true, '진짜: 재승인 필요.');
  ok(H('쿠팡 광고비 결제 승인 부탁드려요') === true && H('상품명 1안으로 진행해도 될까요?') === true && H('A안 B안 중 선택해 주세요') === true, '진짜: 부탁드려요·진행해도 될까요·선택해 주세요');
  ok(H('직접 승인된 변경 요청이 오면 그때 현재 설정을 확인하겠습니다.') === false, '오탐 제거: 승인된 … 오면(조건문)');
  ok(H('판단이나 승인이 필요한 사항은 성래님께 먼저 확인하겠습니다.') === false, '오탐 제거: 승인이 필요한 사항은 … 하겠습니다(약속)');
  ok(H('현재 레이 님께서 해 주셔야 하는 확인이나 승인은 없습니다.') === false && H('1. 프로젝트: 확인·승인 요청 알림 2. 완료 작업') === false, '오탐 제거: 없습니다(부정) · 제목 속 승인 요청');
  ok(H('[뷔투 · 허락 요청] 앞으로 할지 말지 정해야 하는 일은 두 분께 허락받고 진행합니다') === false, '오탐 제거: 꼬리표 [허락 요청] · 절차 안내');
  // 입력 검사
  ok(post({ action: 'approval_decide', key: KA, id: 'Q-a2', decision: 'maybe' }).ok === false, '모르는 결정은 거절');
  ok(post({ action: 'approval_decide', key: KA, id: 'Q-a6', decision: 'approve' }).ok === false, '승인 요청이 아닌 말(레이 님이 비서에게 보낸 말)은 결정할 수 없다');
  ok(post({ action: 'approval_decide', key: KA, id: 'Q-none', decision: 'approve' }).ok === false, '없는 id 는 거절');
  ok(post({ action: 'approval_decide', id: 'Q-a2', decision: 'approve' }).error === 'unauthorized', '키 없이는 결정 못 한다');
  S.props.QUEUE_SHEET_ID = 'SHEETidReact2101';
}

console.log('\n25) 🤝 유기적 협업 — 공지·알림 전달 · 협업 요청 자동 할 일 · 어사이드 승인 · 정리 새 갈래 (2026-11-27)');
{
  const KC = S.props.SECRET_KEY;
  const SC = 'SHEETidCollab2501';
  const HEADC = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash','branch'];
  const now = S.sb.Date.now();
  const iso = ms => new Date(ms).toISOString();
  const mkC = (id, hoursAgo, source, payload, status, extra) => {
    const row = new Array(HEADC.length).fill('');
    row[HEADC.indexOf('id')] = id; row[HEADC.indexOf('created_at')] = iso(now - hoursAgo * 3600000);
    row[HEADC.indexOf('source')] = source; row[HEADC.indexOf('type')] = 'claude_prompt'; row[HEADC.indexOf('workspace')] = 'gaegyebu';
    row[HEADC.indexOf('payload')] = JSON.stringify(payload); row[HEADC.indexOf('status')] = status || 'PENDING';
    Object.keys(extra || {}).forEach(k => { const i = HEADC.indexOf(k); if (i >= 0) row[i] = extra[k]; });
    return row;
  };
  const chat = (target, prompt, x) => Object.assign({ prompt, mode: 'ask', kind: 'chat', target }, x || {});
  S.addSheet(SC, { 'Command_Queue': [HEADC.slice(0),
    mkC('Q-c1', 100, 'portal', chat('keyring2', '@키투 규칙 공지 읽어')),                                          // 접수 후 100시간 방치 → seen_stale
    mkC('Q-c2', 100, 'portal', { prompt: '콘텐츠 허브 고쳐', mode: 'edit' }, 'REVIEW_NEEDED', { branch: 'auto-review/Q-c2', claimed_by: 'notebook' }), // 보류 브랜치 → review
    mkC('Q-c3', 10, 'portal', { prompt: '최근 보류', mode: 'edit' }, 'REVIEW_NEEDED', { branch: 'auto-review/Q-c3' }),     // 3일 안 → 그대로
    mkC('Q-c4', 30, 'portal', chat('cue', '@큐 안 읽은 일')),                                                     // 미접수 → 자동 모드에선 안 닫는다
    mkC('Q-c5', 5, 'pi1', chat('all', '@전체 예전 공지')),                                                       // 예전 @전체 → broadcast
    mkC('Q-c6', 5, 'portal', chat('vooy', '알림입니다', { notice: true }))                                          // 예전 배포에서 남은 알림 → broadcast
  ], 'Reactions': [['at', 'order_id', 'agent', 'emoji'], [iso(now - 99 * 3600000), 'Q-c1', 'keyring2', '👀']] });
  S.props.QUEUE_SHEET_ID = SC;
  S.props.WEBHOOK_TRIGGERS_JSON = JSON.stringify({ cue: 'https://hook.test/cue', cue2: 'https://hook.test/cue2' });
  S.sb.CacheService.getScriptCache().put('qq_check_log_v1', '{}');
  S.sb.CacheService.getScriptCache().put('qq_autosweep_at', '');
  const enq = (source, payload, extra) => post(Object.assign({ action: 'queue_enqueue', key: KC, type: 'claude_prompt', workspace: 'gaegyebu', source, payload }, extra || {}));
  const rowC = id => S.books[SC]['Command_Queue'].find(r => r[0] === id) || [];
  const stC = id => rowC(id)[HEADC.indexOf('status')];
  const pl = r => { try { return JSON.parse(r[HEADC.indexOf('payload')] || '{}'); } catch (e) { return {}; } };

  // ① @전체 공지·알림(notice) — 접수 순간 닫히고, 폴링 비서 받은편지함엔 한 번
  post({ action: 'queue_inbox', key: KC, as: 'vooy2' });                                  // 첫 확인(이전 것은 여기서 소비)
  const all = enq('portal', chat('all', '📢 내일 회의는 10시'));
  ok(all.ok === true && all.item.status === 'DONE', '@전체 공지는 접수 순간 전달 완료(DONE)');
  const nt = enq('pi1', chat('vooy2', '참고로 오늘 배포 끝났어요', { notice: true }));
  ok(nt.ok === true && nt.item.status === 'DONE', '알림(notice)도 접수 순간 닫힌다');
  let ib = post({ action: 'queue_inbox', key: KC, as: 'vooy2' });
  const ibIds = ib.items.map(x => x.id);
  ok(ibIds.indexOf(all.item.id) >= 0 && ibIds.indexOf(nt.item.id) >= 0 && ib.cast === 2, '닫혔어도 받은편지함엔 한 번 온다(공지·내 앞 알림)');
  ib = post({ action: 'queue_inbox', key: KC, as: 'vooy2', since: all.item.created_at > nt.item.created_at ? all.item.created_at : nt.item.created_at });
  ok(ib.count === 0, '두 번째 확인엔 다시 안 온다');
  const done = enq('pi1', chat('vooy2', '이건 일감'), {});
  enq('vooy2', chat('pi1', '했어요 — 결과 첨부', { reply_to: done.item.id }));             // 답장으로 닫힘
  ib = post({ action: 'queue_inbox', key: KC, as: 'vooy2' });
  ok(ib.items.every(x => x.id !== done.item.id), '이미 닫힌 내 일감(알림 아님)은 다시 주지 않는다');
  ok(post({ action: 'queue_list', key: KC, limit: 20 }).items.filter(x => x.target === 'all' && x.status === 'PENDING').length === 1, '새 @전체는 대기로 안 남는다(예전 것 1건만)');

  // ② 협업 요청 — 보고서의 '협업 필요' 줄이 그 비서의 할 일이 된다
  S.fetchCalls.length = 0;
  const rep = enq('vooy', chat('portal', '1. 프로젝트: 묘한살림\n2. 완료 작업: 비교표\n4. 협업 필요: 큐투(팩트체크), 키투(예약), 노트북(빌드), 부이(본인), 피원(검토)'));
  ok(rep.ok === true && rep.item.status === 'DONE', '사람 앞 보고는 그대로 전달 완료');
  const kids = rep.collab || [];
  ok(kids.length === 3 && kids.map(k => k.to).sort().join() === 'cue2,keyring2,pi1', '협업 요청은 최대 3명 — 노트북·자기 자신(부이)은 빠진다');
  const k1 = rowC(kids.find(k => k.to === 'keyring2').id); const kp = pl(k1);
  ok(k1[HEADC.indexOf('status')] === 'PENDING' && k1[HEADC.indexOf('source')] === 'vooy' && kp.target === 'keyring2' && kp.reply_to === rep.item.id && kp.collab === true, '자식 줄: 부이가 키투 앞으로 · reply_to=원 보고(스레드) · collab 표시 · 대기');
  ok(/협업 요청 · 자동/.test(kp.prompt) && /큐투\(팩트체크\)/.test(kp.prompt) && /원문: /.test(kp.prompt) && /🙅/.test(kp.prompt), '본문: 누가·무엇을·원문 id·할 수 없으면 🙅');
  const cueHits = S.fetchCalls.filter(c => c.url === 'https://hook.test/cue2');
  ok(cueHits.length === 1 && JSON.parse(cueHits[0].opts.payload).target === 'cue2', '웹훅 비서(큐투)는 자기 앞 협업 요청으로 한 번만 깨어난다');
  const ik = post({ action: 'queue_inbox', key: KC, as: 'keyring2' });
  ok(ik.items.some(x => x.id === kids.find(k => k.to === 'keyring2').id) && ik.items.every(x => x.id !== rep.item.id), '폴링 비서(키투) 받은편지함: 협업 요청만(원 보고는 중복으로 안 줌)');
  // 협업 요청에 답하면 그 줄이 닫힌다(답장 닫기 규칙 그대로)
  const kid = kids.find(k => k.to === 'keyring2').id;
  const kr = enq('keyring2', chat('vooy', '예약 확인했어요 — 금요일 2시', { reply_to: kid }));
  ok(kr.closed && kr.closed.id === kid && stC(kid) === 'DONE', '협업 요청에 reply_to 로 답하면 닫힌다');
  ok(!(kr.collab && kr.collab.length), '답장·협업 요청 자체는 또 협업 요청을 만들지 않는다(무한 연쇄 없음)');
  const nested = enq('cue2', chat('vooy', '[협업 요청 · 자동] 흉내\n4. 협업 필요: 키투', { collab: true }));
  ok(!(nested.collab && nested.collab.length), 'collab 표시가 붙은 말은 다시 퍼뜨리지 않는다');
  const none = enq('pi2', chat('portal', '보고\n4. 협업 필요: 없음'));
  ok(!(none.collab && none.collab.length), '협업 필요: 없음 → 아무것도 안 만든다');
  const direct = enq('pi2', chat('cue2', '@큐투 이거 봐줘\n4. 협업 필요: 큐투'));
  ok(!(direct.collab && direct.collab.length), '이미 받는 사람인 비서에겐 협업 요청을 따로 안 만든다');

  // ③ 결정 알림 — 이름으로·notice 로(대기로 안 남는다)
  const ask = enq('vooy2', { kind: 'approval', prompt: '@피원 @피투 [뷔투 · 허락 요청] 상품명 1안으로 바꿀게요\n근거는 검색량' });
  const dec = post({ action: 'approval_decide', key: KC, id: ask.item.id, decision: 'approve', note: '좋아' });
  const dr = rowC(dec.reply_id); const dp = pl(dr);
  ok(dr[HEADC.indexOf('status')] === 'DONE' && dp.notice === true, '결정 알림은 알림(notice)으로 — 접수 순간 닫힌다(브리핑 안 읽음에 안 센다)');
  ok(/^@뷔투 \[레이 님 결정\] ✅ 승인 — \[뷔투 · 허락 요청\] 상품명 1안으로 바꿀게요/.test(dp.prompt), '알림은 이름(@뷔투)으로, 제목 앞 @멘션은 떼고');

  // ④ 🌿 어사이드 — 외부 작업은 비서가 시키면 레이 님 승인, 상태 확인·사람 버튼은 그대로
  const asideAgent = enq('pi2', chat('notebook', '🌿어사이드 무신사'));
  ok(asideAgent.ok === true && asideAgent.item.status === 'WAITING_APPROVAL' && asideAgent.item.risk_level === 'HIGH', '비서가 시킨 외부 작업(무신사) → 승인 대기');
  ok(post({ action: 'approval_list', key: KC }).items.some(x => x.id === asideAgent.item.id && x.approval_kind === 'order'), '승인함에 실행 승인으로 모인다');
  const asideStatus = enq('pi2', chat('notebook', '🌿어사이드 상태'));
  ok(asideStatus.item.status === 'PENDING', '상태 확인은 승인 없이(읽기 전용)');
  const asideHuman = enq('portal', chat('notebook', '🌿 어사이드 네이버'));
  ok(asideHuman.item.status === 'PENDING', '레이 님이 포털 버튼으로 보낸 건 그대로(화면에서 이미 한 번 묻는다)');
  ok(enq('pi2', chat('notebook', '🌿어사이드 무신사 하고 보고해줘')).item.status === 'PENDING', '한 줄 명령이 아닌 말은 어사이드가 아니다(노트북 대화)');

  // ⑤ 정리 — 자동 모드: 안전한 갈래만 · 6시간에 한 번
  const a1 = post({ action: 'queue_sweep', key: KC, auto: true });
  ok(a1.ok === true && a1.auto === true && a1.apply === true && !a1.skipped, '자동 정리는 바로 적용한다');
  ok(stC('Q-c1') === 'EXPIRED' && /접수\(👀\) 뒤 3일/.test(rowC('Q-c1')[HEADC.indexOf('error')]), '접수 후 3일 넘게 방치 → 닫는다(seen_stale)');
  ok(stC('Q-c2') === 'EXPIRED' && /auto-review\/Q-c2 는 GitHub 에 그대로/.test(rowC('Q-c2')[HEADC.indexOf('error')]), '3일 넘은 보류 브랜치 → 기록만 닫고 브랜치 이름을 남긴다');
  ok(stC('Q-c3') === 'REVIEW_NEEDED', '3일 안 된 보류 브랜치는 그대로');
  ok(stC('Q-c4') === 'PENDING', '자동 모드는 미접수 일감을 닫지 않는다(안 읽는 비서를 숨기지 않는다)');
  ok(stC('Q-c5') === 'DONE' && stC('Q-c6') === 'DONE' && /전달됨/.test(rowC('Q-c5')[HEADC.indexOf('result')]), '예전 @전체 공지·알림 → 전달됨으로 닫는다');
  const a2 = post({ action: 'queue_sweep', key: KC, auto: true });
  ok(a2.skipped === true && !!a2.last_at, '6시간 안에 다시 부르면 건너뛴다');
  ok(post({ action: 'queue_sweep', key: KC, auto: true, force: true }).skipped !== true, 'force 면 바로 다시 돈다');
  ok(post({ action: 'queue_sweep', key: KC }).apply === false, '보통 호출은 여전히 미리보기');
  delete S.props.WEBHOOK_TRIGGERS_JSON;
  S.props.QUEUE_SHEET_ID = 'SHEETidReact2101';
}

console.log('\n10) 🔔 외부 비서 웹훅 (등록 · 발사 조건 · 무한루프 방지)');
{
  const K4 = S.props.SECRET_KEY;
  const CUE = 'https://hook.test/cue', CUE2 = 'https://hook.test/cue2';
  S.props.WEBHOOK_TRIGGERS_JSON = JSON.stringify({cue: CUE, cue2: CUE2});
  S.fetchCalls.length = 0;
  const enq = (extra) => Object.assign({action:'queue_enqueue', key:K4, type:'claude_prompt', workspace:'gaegyebu'}, extra);
  const chat = (target, prompt, source) => ({payload:{prompt:prompt, mode:'ask', kind:'chat', target:target}, source:source});

  // ① 큐투 앞 대화 → 큐투만 깨어난다. 본문은 큐투 규격 그대로.
  S.fetchCalls.length = 0;
  let w = post(enq(chat('cue2', '@큐투 이거 봐줘', 'portal')));
  ok(w.ok === true, '큐투 앞 대화 접수');
  const call1 = S.fetchCalls[0] || {};
  ok(S.fetchCalls.length === 1 && call1.url === CUE2, '큐투 앞 오더는 큐투 웹훅 하나만 부른다');
  ok(call1.opts && call1.opts.method === 'post' && call1.opts.contentType === 'application/json', 'POST · application/json 으로 보낸다');
  ok(call1.opts && !call1.opts.headers, '인증 헤더 없음');
  const b1 = call1.opts ? JSON.parse(call1.opts.payload) : {};
  // 2026-11-26 — 깨어난 비서가 바로 읽는 자리에 완료 보고 규칙(report_rule)을 더했다(기존 키는 그대로).
  ok(Object.keys(b1).sort().join(',') === 'created_at,id,mentions,prompt,report_rule,summary,target', '본문은 {id,target,mentions,summary,prompt,created_at} + report_rule');
  ok(typeof b1.report_rule === 'string' && /보고/.test(b1.report_rule) && /reply_to/.test(b1.report_rule), 'report_rule 에 “끝나면 회의실 보고”가 담긴다');
  ok(b1.id === w.item.id && b1.target === 'cue2' && b1.created_at === w.item.created_at, 'id · target · created_at 이 큐 줄과 같다');
  ok(Array.isArray(b1.mentions) && b1.mentions.indexOf('cue2') >= 0, 'mentions 에 큐투가 들어 있다');
  ok(typeof b1.summary === 'string' && b1.summary.indexOf('이거 봐줘') >= 0, 'summary 에 본문이 담긴다');
  // 2026-11-26 — 160자에서 잘리던 대화 본문이 줄바꿈 그대로, 끝까지 내려간다.
  const longChat = '첫 줄입니다\n둘째 줄입니다\n' + '가'.repeat(400) + '\n마지막 줄입니다';
  S.fetchCalls.length = 0;
  const wLong = post(enq(chat('cue2', longChat, 'portal')));
  const bLong = S.fetchCalls[0] ? JSON.parse(S.fetchCalls[0].opts.payload) : {};
  ok(wLong.ok === true && bLong.summary === longChat, '긴 대화도 160자에서 안 잘리고 줄바꿈 그대로 summary 에 온다');
  ok(bLong.prompt === longChat, '웹훅 prompt 에도 원문 전체가 온다');
  // 발사 결과는 6시간 캐시에 코드만 남고, GET webhook_last 로 볼 수 있다
  let lw = JSON.parse(S.sb.doGet({parameter:{action:'webhook_last', key:K4}}).getContent());
  ok(lw.ok === true && lw.last.cue2 && lw.last.cue2.code === 200, 'GET webhook_last 에 응답 코드 200 이 남는다');
  ok(!JSON.stringify(lw).includes('hook.test'), 'webhook_last 응답에 웹훅 주소가 없다');

  // ② 본인이 낸 글에는 본인을 깨우지 않는다(무한루프 방지)
  S.fetchCalls.length = 0;
  post(enq(Object.assign(chat('cue2', '@큐투 내가 나한테', 'cue2'))));
  ok(S.fetchCalls.length === 0, 'source=cue2 인 글에는 cue2 를 깨우지 않는다');

  // ③ target='all' → 둘 다 깨우고, 각자 mentions 에 자기 id 가 반드시 들어간다
  S.fetchCalls.length = 0;
  post(enq(chat('all', '@전체 다들 봐', 'portal')));
  ok(S.fetchCalls.length === 2, '@전체는 등록된 비서 모두(2)를 깨운다');
  S.fetchCalls.forEach(c => {
    const b = JSON.parse(c.opts.payload);
    const id = c.url === CUE ? 'cue' : 'cue2';
    ok(b.target === 'all' && b.mentions.indexOf(id) >= 0, `target=all 이어도 mentions 에 ${id} 가 들어간다`);
  });

  // ④ target 없이 본문 멘션만 있어도 그 비서를 깨운다
  S.fetchCalls.length = 0;
  post(enq({payload:{prompt:'@큐투 확인 부탁', mode:'ask'}, source:'pi1'}));
  ok(S.fetchCalls.length === 1 && S.fetchCalls[0].url === CUE2, '본문 @큐투 만으로도 큐투를 깨운다');

  // ④-2 '협업 필요' 줄에 @ 없이 적은 이름도 그 비서를 깨운다(2026-11-26)
  S.fetchCalls.length = 0;
  const collab = post(enq(Object.assign(chat('portal', '조사 마쳤습니다.\n\n1. 프로젝트: 포털\n4. 협업 필요: 큐투(팩트체크), 노트북(빌드)'), { source: 'pi1' })));
  ok(collab.ok === true, '협업 줄이 든 보고 접수');
  const hit = S.fetchCalls.filter(c => c.url === CUE2);
  ok(hit.length === 1, '@ 없는 협업 줄 이름(큐투)으로 큐투 웹훅이 깨어난다');
  const cb = hit[0] ? JSON.parse(hit[0].opts.payload) : {};
  ok(cb.target === 'cue2' && /협업 요청/.test(cb.summary || '') && (cb.mentions || []).indexOf('cue2') >= 0, '큐투는 원 보고가 아니라 자기 앞 협업 요청으로 한 번 깨어난다(중복 깨움 없음)');
  ok((collab.collab || []).some(c => c.to === 'cue2') && !(collab.collab || []).some(c => c.to === 'notebook'), '협업 요청은 큐투에게만 — 노트북은 빼고(실행은 오더로)');
  S.fetchCalls.length = 0;
  post(enq(Object.assign(chat('portal', '4. 협업 필요: 큐투 확인'), { source: 'cue2' })));
  ok(S.fetchCalls.length === 0, '협업 줄에 적힌 자기 자신(source)은 깨우지 않는다');

  // ⑤ 상관없는 오더·포털 앞 대화는 아무도 깨우지 않는다
  S.fetchCalls.length = 0;
  post(enq({type:'git_pull', workspace:'gaegyebu', payload:{}}));
  post(enq(chat('portal', '@포털 확인', 'cue')));
  post(enq({payload:{prompt:'제목만 고쳐줘', mode:'ask'}, source:'portal'}));
  ok(S.fetchCalls.length === 0, '대상 없는 오더 · 포털 앞 대화에는 웹훅을 쏘지 않는다');

  // ⑥ 웹훅이 죽어도 접수는 성공한다
  S.fetchCalls.length = 0; S.setFetchFail(true);
  const survived = post(enq(chat('cue2', '@큐투 살아있니', 'portal')));
  S.setFetchFail(false);
  ok(survived.ok === true && survived.item && survived.item.id, '웹훅이 실패해도 queue_enqueue 는 성공');
  ok(JSON.parse(S.sb.doGet({parameter:{action:'webhook_last', key:K4}}).getContent()).last.cue2.error !== '', '실패한 호출은 webhook_last 에 오류로 남는다');

  // ⑦ target 이 다른 비서면 그 비서만
  S.fetchCalls.length = 0;
  post(enq(chat('cue', '@큐 이건 네 거', 'portal')));
  ok(S.fetchCalls.length === 1 && S.fetchCalls[0].url === CUE, 'cue 앞 오더는 cue 웹훅만 부른다');

  // ⑧ 등록 API — 주소는 응답·로그에 돌려주지 않는다
  S.props.WEBHOOK_TRIGGERS_JSON = '';
  let s = post({action:'webhook_set', key:K4, triggers:{cue:CUE, cue2:CUE2}});
  ok(s.ok === true && s.ids.length === 2 && s.count === 2, 'webhook_set 으로 두 비서를 등록');
  ok(!JSON.stringify(s).includes('hook.test'), '응답에 웹훅 주소가 없다');
  const saved = JSON.parse(S.props.WEBHOOK_TRIGGERS_JSON);
  ok(saved.cue === CUE && saved.cue2 === CUE2, 'ScriptProperties(WEBHOOK_TRIGGERS_JSON)에만 저장된다');
  s = post({action:'webhook_set', key:K4, triggers:{cue2:'http://insecure.test/x'}});
  ok(s.ok === false && s.code === 'bad_request', 'http(비 https) 주소는 거절');
  s = post({action:'webhook_set', key:K4, triggers:{'큐투':CUE2}});
  ok(s.ok === false && s.code === 'bad_request', '에이전트 id 규칙에 안 맞는 키는 거절');
  s = post({action:'webhook_set', key:K4, triggers:{cue:CUE}});
  ok(s.ok === true && JSON.parse(S.props.WEBHOOK_TRIGGERS_JSON).cue2 === CUE2, '부분 갱신 — 안 준 키는 그대로');
  s = post({action:'webhook_set', key:K4, triggers:{cue:''}});
  const after = JSON.parse(S.props.WEBHOOK_TRIGGERS_JSON);
  ok(s.ok === true && !after.cue && after.cue2 === CUE2, '빈 문자열이면 그 키만 지운다');
  S.props.WEBHOOK_TRIGGERS_JSON = 'not json';
  S.fetchCalls.length = 0;
  post(enq(chat('cue2', '@큐투 깨져도 돼', 'portal')));
  ok(S.fetchCalls.length === 0, '속성이 깨져 있으면 조용히 아무도 안 깨운다(접수는 성공)');
}

console.log(`\n포털 서버 테스트: ${pass}건 통과, ${fail}건 실패`);
process.exit(fail?1:0);
