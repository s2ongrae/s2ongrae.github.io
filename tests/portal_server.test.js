const mk = require('./lib/portal_fake_server.js');
let pass=0, fail=0; const ok=(c,m)=>{ if(c) pass++; else { fail++; console.log('  ❌',m); } };
const S = mk(), K = S.KEY, post = S.post;
const memo = (id,x={})=>Object.assign({id,title:'제목'+id,body:'내용'+id,color:'mc-blue',pinned:false,updatedAt:'2026-10-01T00:00:00Z'},x);

console.log('1) 접근 통제');
let r = S.doGet(); ok(r.ok===false && r.error==='POST로만 사용할 수 있어요.' && Object.keys(r).length===2, 'doGet은 안내 문구만(캘린더·메모 안 줌)');
for(const a of ['getTaskLists','getTasks','addTask','completeTask','deleteTask','getCalendarEvents','createEvent','deleteEvent','loadMemos','saveMemos','ping']){
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

console.log(`\n포털 서버 테스트: ${pass}건 통과, ${fail}건 실패`);
process.exit(fail?1:0);
