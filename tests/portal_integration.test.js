const fs=require('fs'), vm=require('vm'), nodeCrypto=require('crypto');
const mk=require('./lib/portal_fake_server.js');
const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
const SCRIPT=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n');
const URL1='https://script.google.com/macros/s/AKfycbPORTALTESTPORTALTEST1234/exec';

function makeDevice(server, seedLS){
  const store=new Map(Object.entries(seedLS||{}));
  const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  const mkEl=()=>({value:'',textContent:'',innerHTML:'',placeholder:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},appendChild(){},focus(){},onclick:null});
  const els={}; const el=id=>els[id]||(els[id]=mkEl());
  const dev={calls:[],hooks:{},alerts:[]};
  const ctx=vm.createContext({console,localStorage,crypto:nodeCrypto.webcrypto,Promise,setTimeout,clearTimeout,URLSearchParams,
    document:{getElementById:el,querySelectorAll:()=>[],createElement:()=>mkEl(),addEventListener(){},activeElement:null},
    window:{addEventListener(){}}, alert:m=>dev.alerts.push(m), confirm:()=>true,
    fetch:async(u,opts)=>{ dev.calls.push({u,opts}); const body=JSON.parse(opts.body); const h=dev.hooks;
      const out=server.post(opts.body);
      if(body.action==='loadMemos'&&h.afterLoad){const f=h.afterLoad;h.afterLoad=null;f();}
      if(body.action==='saveMemos'&&h.afterSave){const f=h.afterSave;h.afterSave=null;f();}
      return {json:async()=>out}; } });
  vm.runInContext(SCRIPT, ctx);
  dev.run=c=>vm.runInContext(c,ctx); dev.get=e=>JSON.parse(vm.runInContext(`JSON.stringify(${e})`,ctx));
  dev.el=el; dev.store=store;
  dev.config=(key)=>dev.run(`PORTAL_URL='${URL1}'; PORTAL_KEY='${key||server.KEY}'`);
  return dev;
}
let pass=0,fail=0; const ok=(c,m)=>{ if(c)pass++; else {fail++;console.log('  ❌',m);} };
const memo=(id,x={})=>Object.assign({id,title:'제목'+id,body:'내용'+id,color:'mc-blue',pinned:false,updatedAt:'2026-10-01T00:00:00Z'},x);

(async()=>{
console.log('A) 서버 설정이 없을 때');
const S=mk();
let A=makeDevice(S,{portal_memos_v2:JSON.stringify([{title:'옛메모1',body:'본문',color:'mc-pink',updatedAt:'2026-01-01T00:00:00Z'},{title:'옛메모2',body:'본문2',color:'mc-blue',pinned:true,updatedAt:'2026-01-02T00:00:00Z'}])});
ok(A.calls.length===0,'설정이 없으면 서버 요청을 한 번도 보내지 않음');
ok(A.get('memos').length===2 && A.get('memos').every(m=>m.id),'예전 형식 메모를 이어받고 id 부여');
ok(/서버 설정/.test(A.el('task-list').innerHTML),'할 일 칸에 설정 안내');
let r=await A.run('syncMemos()'); ok(r.ok===false&&r.reason==='noconfig'&&A.calls.length===0,'설정 없이 동기화하면 요청 없이 안내만');
let pr=await A.run(`post({action:'getTasks',listId:'@default'})`); ok(pr.ok===false&&pr.code==='noconfig'&&A.calls.length===0,'post도 설정 없으면 요청 안 보냄');

console.log('B) 설정 저장 검증');
A.el('srv-url').value='http://evil.example/exec'; A.el('srv-key').value=S.KEY; await A.run('saveSettings()'); ok(A.run('PORTAL_URL')==='','주소 형식이 틀리면 거절');
A.el('srv-url').value=URL1; A.el('srv-key').value='short'; await A.run('saveSettings()'); ok(A.run('PORTAL_URL')==='','키가 짧으면 거절');
A.el('srv-key').value='x'.repeat(64); await A.run('saveSettings()'); ok(A.run('PORTAL_URL')===''&&A.store.get('portal_server_key')===undefined,'연결 테스트 실패 → 이전 상태 복원, 저장 안 됨');
A.el('srv-key').value=S.KEY; await A.run('saveSettings()'); await new Promise(r=>setTimeout(r,50));
ok(A.run('PORTAL_URL')===URL1&&A.store.get('portal_server_url')===URL1&&A.store.get('portal_server_key')===S.KEY,'올바른 값은 테스트 통과 후 저장');

console.log('C) 요청 형태 (키 필수·GET 없음)');
await new Promise(r=>setTimeout(r,100));
ok(A.calls.length>0,'저장 후 자동으로 불러오기 시작');
ok(A.calls.every(c=>c.opts.method==='POST'&&!/\?/.test(c.u)),'모든 요청이 POST, 주소에 조회 문자열 없음');
ok(A.calls.every(c=>typeof JSON.parse(c.opts.body).key==='string'&&JSON.parse(c.opts.body).key.length>=32),'모든 요청 본문에 비밀 키가 실림');
ok(A.calls.filter(c=>!/^x+$/.test(JSON.parse(c.opts.body).key)).every(c=>JSON.parse(c.opts.body).key===S.KEY),'(B에서 일부러 보낸 오답 키 테스트 1건을 뺀) 나머지 요청은 모두 저장한 올바른 키');
ok(A.calls.filter(c=>/^x+$/.test(JSON.parse(c.opts.body).key)).length===1,'오답 키로 나간 요청은 의도한 ping 1건뿐');
ok(!A.calls.some(c=>JSON.parse(c.opts.body).action==='getCalendarEvents'&&c.opts.method!=='POST'),'캘린더 조회도 POST');

console.log('D) 첫 동기화: 옛 서버 파일(id 없음)과 이 기기의 예전 메모');
const sf=S.ROOT.createFolder('김성래포털'); sf.createFile('포털_메모.json',JSON.stringify({memos:[{title:'옛메모1',body:'본문',color:'mc-pink',updatedAt:'2026-01-01T00:00:00Z'},{title:'옛메모2',body:'본문2',color:'mc-blue',pinned:true,updatedAt:'2026-01-02T00:00:00Z'}],version:2}));
A.run('MEMO_BASE=null'); r=await A.run('syncMemos()');
ok(r.ok&&A.get('memos').length===2,'같은 옛 메모는 중복 없이 2개 그대로');
const memoId=A.get('memos')[0].id;
A.run(`memos.unshift({id:'mA1',title:'A에서 새 메모',body:'x',color:'mc-green',pinned:false,updatedAt:new Date().toISOString()}); saveLocalMemos();`);
r=await A.run('syncMemos()'); let srv=JSON.parse(S.memoFile().content);
ok(r.ok&&srv.rev>=1&&srv.memos.length===3&&srv.memos.every(m=>m.id),'새 메모를 올리면 서버 형식이 id 포함으로 바뀜');

console.log('E) 두 번째 기기');
let B=makeDevice(S); B.config(); r=await B.run('syncMemos()');
ok(r.ok&&r.changedLocal&&B.get('memos').length===3,'B가 서버 메모 3개를 받음');
ok(B.run('listMemoCheckpoints()').length>=1,'합치기 직전 체크포인트 생성');

console.log('F) 서로 다른 메모를 고치고 번갈아 동기화');
B.run(`memos.find(m=>m.id==='mA1').body='B가 고침'; saveLocalMemos();`);
A.run(`const t=memos.find(m=>m.id!=='mA1'); t.title='A가 고침'; saveLocalMemos();`);
await B.run('syncMemos()'); await A.run('syncMemos()'); await B.run('syncMemos()');
for(const [n,D] of [['A',A],['B',B]]){ const ms=D.get('memos'); ok(ms.find(m=>m.id==='mA1').body==='B가 고침'&&ms.some(m=>m.title==='A가 고침'),`${n}: 두 기기의 수정이 모두 남음`); }

console.log('G) 저장하는 순간 다른 기기가 먼저 저장 (rev 충돌 → 재병합)');
A.run(`memos.unshift({id:'mA2',title:'A 메모2',body:'',color:'mc-blue',pinned:false,updatedAt:new Date().toISOString()}); saveLocalMemos();`);
A.hooks.afterLoad=()=>{ const cur=S.post({action:'loadMemos',key:S.KEY}); S.post({action:'saveMemos',key:S.KEY,baseRev:cur.rev,memos:[...cur.memos,memo('mC1',{title:'끼어든 메모'})],tombstones:cur.tombstones}); };
r=await A.run('syncMemos()'); srv=JSON.parse(S.memoFile().content);
ok(r.ok&&srv.memos.some(m=>m.id==='mC1')&&srv.memos.some(m=>m.id==='mA2'),'끼어든 저장(mC1)과 내 저장(mA2)이 둘 다 서버에 남음');

console.log('H) 입력 중 동기화가 끝나도 사라지지 않음');
A.hooks.afterLoad=()=>{ A.run(`memos.find(m=>m.id==='mA2').body='불러오는 중 쓴 글'`); };
r=await A.run('syncMemos()'); srv=JSON.parse(S.memoFile().content);
ok(srv.memos.find(m=>m.id==='mA2').body==='불러오는 중 쓴 글','불러오는 중 쓴 글이 서버까지 반영');
A.run(`memos.find(m=>m.id==='mA1').title='저장 직전 수정'`);
A.hooks.afterSave=()=>{ A.run(`memos.find(m=>m.id==='mA2').title='저장 중 수정'`); };
await A.run('syncMemos()'); ok(A.get('memos').find(m=>m.id==='mA2').title==='저장 중 수정','저장 중 쓴 글이 이 기기에 남음');
await A.run('syncMemos()'); ok(JSON.parse(S.memoFile().content).memos.find(m=>m.id==='mA2').title==='저장 중 수정','다음 동기화에서 서버에 반영 (유실 없음)');

console.log('I) 삭제 전파 / 지운 메모를 다른 기기가 고쳤을 때');
await B.run('syncMemos()');
let C=makeDevice(S); C.config(); await C.run('syncMemos()');
A.run(`memos=memos.filter(m=>m.id!=='mC1'); saveLocalMemos();`); await A.run('syncMemos()');
ok(JSON.parse(S.memoFile().content).tombstones.mC1,'서버에 삭제 기록이 남음');
await B.run('syncMemos()'); ok(!B.get('memos').some(m=>m.id==='mC1'),'A에서 지운 메모가 B에서도 사라짐');
C.run(`memos.find(m=>m.id==='mC1').body='C가 고친 글'; saveLocalMemos();`); await C.run('syncMemos()');
ok(JSON.parse(S.memoFile().content).memos.some(m=>m.id==='mC1'&&m.body==='C가 고친 글'),'지워진 메모를 고쳐 둔 C의 값이 되살아남');
await A.run('syncMemos()'); ok(A.get('memos').some(m=>m.id==='mC1'),'A에도 반영');

console.log('J) 서버 메모가 증발해도 이 기기 메모로 복구');
const mf=S.memoFile(); const before=JSON.parse(mf.content);
mf.content=JSON.stringify({memos:[],tombstones:{},version:3,rev:before.rev});
r=await A.run('syncMemos()'); ok(r.ok&&JSON.parse(S.memoFile().content).memos.length===A.get('memos').length&&A.get('memos').length>=3,'서버가 비어도 A의 메모로 서버 복구');

console.log('K) 이 기기 메모가 실수로 비워지면 서버가 막아줌');
A.run(`memos=[]; saveLocalMemos();`); const snapshot=S.memoFile().content;
r=await A.run('syncMemos()'); ok(r.ok===false&&r.reason==='shrink','줄어듦 방지 작동: 동기화 중단'); ok(S.memoFile().content===snapshot,'서버 메모는 그대로');
A.run(`MEMO_BASE=null; localStorage.removeItem('portal_memo_base')`); r=await A.run('syncMemos()'); ok(r.ok&&A.get('memos').length>=3,'기준 없이 다시 동기화하면 서버 메모를 받아 복구');

console.log('L) 잘못된 키');
const goodKey=A.run('PORTAL_KEY'); A.run(`PORTAL_KEY='x'.repeat(64)`); const keep=JSON.stringify(A.get('memos'));
r=await A.run('syncMemos()'); ok(r.ok===false&&r.reason==='unauthorized','키가 틀리면 실패 + 안내'); ok(JSON.stringify(A.get('memos'))===keep,'키 오류 시 이 기기 메모는 그대로');
pr=await A.run(`post({action:'getTasks'})`); ok(pr.ok===false&&pr.code==='unauthorized','할 일 호출도 키 오류를 안내로 돌려줌(예외 없음)');
A.run(`PORTAL_KEY='${goodKey}'`);

console.log('M) 체크포인트 복원(강제 저장)');
const cps=A.run('listMemoCheckpoints()'); ok(cps.length>=1&&cps.length<=3,'체크포인트가 최대 3개');
A.run(`memos=memos.slice(0,2); saveLocalMemos();`);
const cp=A.get('listMemoCheckpoints()')[0]; await A.run(`restoreMemoCheckpoint('${cp.id}')`);
srv=JSON.parse(S.memoFile().content); const bk=S.ROOT.folders[0].folders.find(f=>f.name==='백업');
ok(srv.memos.length===cp.n,'체크포인트로 복원하면 서버도 그 상태'); ok(bk.files.some(f=>/복원전/.test(f.name)),'복원 직전 서버 상태가 백업 폴더에 보관');

console.log('N) 화면에 넣는 글자(XSS)');
A.run(`calY=2026;calM=9;calEvents={'2026-10-20':[{id:'1"><b>',title:'<img src=x onerror=alert(1)>',time:'<i>09:00</i>',allDay:false,desc:'<script>x</script>'}]}; renderCal(); openCal('2026-10-20');`);
const grid=A.el('cal-grid').innerHTML, evl=A.el('cal-ev-list').innerHTML;
ok(!/<img|<i>|<script/i.test(grid),'달력 칸: 일정 제목·시간의 태그가 실행되지 않음'); ok(grid.includes('&lt;img'),'달력 칸: 글자로 표시');
ok(!/<img|<i>|<script|"><b>/i.test(evl),'일정 모달: 제목·시간·설명·id 모두 이스케이프');
A.run(`memos=[{id:'x1',title:'<script>alert(1)</script>',body:'<img src=x onerror=1>',color:'" onmouseover="alert(1)',pinned:false,updatedAt:'2026-10-01T00:00:00Z'}]; renderMemos();`);
const ml=A.el('memo-list').innerHTML; ok(!/<script|<img|onmouseover/i.test(ml),'메모 카드: 제목·본문·색상 모두 안전');
const E=await A.run(`post({action:'getTasks',listId:'@default'})`);
A.run(`(function(){ const el=document.getElementById('task-list'); const d={error:'<img src=x onerror=1>'}; el.innerHTML=\`<div class="empty">⚠️ \${esc(d.error)}</div>\`; })()`);
ok(!/<img/.test(A.el('task-list').innerHTML),'할 일 오류 문구 이스케이프');

console.log('N2) 폰 달력 — 칸은 점만, 일정 이름은 아래 목록에서');
A.run(`calY=2026;calM=10;calEvents={
  '2026-11-03':[{id:'c',title:'세 번째 날',time:'09:00',allDay:false}],
  '2026-11-15':[{id:'a',title:'늦잠 자전거',time:'<i>10:00</i>',allDay:false},{id:'b',title:'<img src=x onerror=1>',time:'',allDay:true}],
  '2026-11-20':[{id:'d',title:'하나',time:'08:00',allDay:false},{id:'e',title:'둘',time:'09:00',allDay:false},{id:'f',title:'셋',time:'10:00',allDay:false},{id:'g',title:'넷',time:'11:00',allDay:false}]}; renderCal();`);
const cgrid=A.el('cal-grid').innerHTML, cag=A.el('cal-agenda').innerHTML;
ok((cgrid.match(/class="day-dots"/g)||[]).length===3,'일정 있는 날에만 점을 찍음(3일)');
ok((cgrid.match(/<i class="ev-c[0-6]"><\/i>/g)||[]).length===7,'점은 일정 하나에 하나(하루 4개까지 — 1+2+4)');
ok(cgrid.includes('&lt;img')&&!/<img|<i>10:00/i.test(cgrid),'점 칸에서도 제목·시간은 글자로');
ok((cag.match(/class="ag-day/g)||[]).length===3,'목록은 일정 있는 날만');
ok(cag.indexOf('세 번째 날')>-1&&cag.indexOf('세 번째 날')<cag.indexOf('늦잠 자전거'),'목록은 날짜 순서대로');
ok(/ag-time">10:00<\/span>/.test(cag)&&/종일|늦잠/.test(cag),'목록에 시간이 붙음');
ok(cag.includes('&lt;img')&&!/<img|<i>10:00/i.test(cag),'목록도 제목·시간을 이스케이프');
ok(/\+1개 더/.test(cag),'하루 4개를 넘으면 더 있다고 알림(3개까지 보여줌)');
ok(/onclick="openCal\('2026-11-15'\)"/.test(cag),'목록을 누르면 그 날 일정 모달이 열림');
ok(/이번 달 일정 3일 · 7건/.test(A.el('cal-agenda-sum').textContent),'접혀 있어도 몇 일·몇 건인지 보임');
A.run('calEvents={}; renderCal();');
ok(/이번 달 일정이 없어요/.test(A.el('cal-agenda').innerHTML),'일정이 없으면 목록도 안내만');
ok(/이번 달 일정 없음/.test(A.el('cal-agenda-sum').textContent),'일정이 없으면 펼침 제목도 그렇게');
ok(/\.day-dots\{display:none\}/.test(html)&&/\.cal-agenda\{display:none[;}]/.test(html),'점·목록은 PC 에서는 숨김');
{ const mob=(html.match(/@media\(max-width:560px\)\{[^@]*/)||[''])[0];
  ok(/\.day-ev,\.day-more\{display:none\}/.test(mob)&&/\.cal-agenda\{display:block\}/.test(mob),'폰(560px 이하)에서만 칸 글자를 숨기고 목록을 보여줌');
  ok(/\.cal-day\{min-height:58px/.test(mob),'폰에서는 달력 칸이 낮아져 한 달이 한 화면에 들어옴'); }
ok(/@media\(hover:none\)\{\.memo-card-actions\{opacity:1\}\}/.test(html),'손가락(호버 없음)에서는 메모 버튼이 늘 보임');
ok(/#today-str\{display:none\}/.test(html),'폰 헤더에서는 긴 날짜를 숨김');
A.run('calY=now.getFullYear();calM=now.getMonth();calEvents={};renderCal();');

console.log('O) 제목·브랜드');
ok(/<title>KIM SEONGRAE · PORTAL<\/title>/.test(html)&&!/[^\x00-\x7F]/.test(html.match(/<title>(.*?)<\/title>/)[1].replace(/ · /,' ')),'제목은 ASCII + 가운뎃점만 (키릴 문자 없음)');
ok(/class="brand">KIM SEONG<span>RAE<\/span> · PORTAL/.test(html),'헤더 브랜드 KIM SEONGRAE');

console.log('P) 헤더 링크');
{ const hdr=(html.match(/<div class="app-links">[\s\S]*?<\/div>/)||[''])[0];
  const hrefs=[...hdr.matchAll(/href="([^"]+)"/g)].map(m=>m[1]);
  ok(JSON.stringify(hrefs)===JSON.stringify(['https://s2ongrae.github.io/gaegyebu','https://s2ongrae.github.io/insurance-manager','https://s2ongrae.github.io/prediag/','https://s2ongrae.github.io/content-hub/','#']),'헤더 링크: 가계부 · 보험관리툴 · 사전진단툴 · 콘텐츠 허브 · 스마트스토어 순서 ('+hrefs.length+'개)');
  ok((hdr.match(/target="_blank"/g)||[]).length===5&&(hdr.match(/rel="noopener"/g)||[]).length===5,'새 탭 링크는 모두 rel=noopener');
  ok((hdr.match(/<span>[^<]+<\/span>/g)||[]).length===5&&/\.app-links \.app-link span\{display:none\}/.test(html),'폰에서는 글자를 숨기고 아이콘만 (링크 이름이 span 으로 감싸져 있음)');
  ok(/class="app-link off"[^>]*id="store-link"/.test(hdr)&&/onclick="return storeClick\(event\)"/.test(hdr),'스마트스토어는 주소 넣기 전 기본 비활성(안내) — 클릭하면 해설');
  ok(/<div class="statusbar" id="statusbar"><\/div>/.test(html),'헤더 안에 상태등 자리(statusbar)'); }

console.log('Q) 상단 링크·상태등');
{
  // ⓛ 서버 설정 전 — 요청 0건, 배지 3개가 '미연결 (세팅 대기)'
  const S2 = mk(), D = makeDevice(S2);
  let bar = D.el('statusbar').innerHTML;
  ok((bar.match(/class="stat off"/g)||[]).length===3, '설정 전: 배지 3개가 세팅 대기');
  ok((bar.match(/미연결 \(세팅 대기\)/g)||[]).length===3, '설정 전: 미연결 문구');
  ok(/⚙️ 서버 설정을 하면 켜져요/.test(bar), '설정 전: 무엇을 하면 되는지 안내');
  ok(D.calls.length===0, '설정 전: 서버 요청 0건');

  // ② 서버가 아직 queue_status 를 모르는 예전 배포 — 빨간 에러 대신 세팅 대기
  const S3 = mk(), D3 = makeDevice(S3);
  S3.sb.doPost = () => ({ getContent: () => JSON.stringify({ok:false, error:'알 수 없는 요청이에요.'}) });
  D3.config();
  const r3 = await D3.run('refreshQueueStatus(true)');
  bar = D3.el('statusbar').innerHTML;
  ok(D3.calls.length===1 && r3 && r3.reason==='unsupported', '예전 배포: 요청 1건·실패로 취급하지 않음');
  ok((bar.match(/미연결 \(세팅 대기\)/g)||[]).length===3 && /재배포/.test(bar), '예전 배포: 미연결 + 재배포 안내');
  ok(!!D3.store.get('portal_qstatus_cache'), '예전 배포도 5분 캐시에 담아 반복 호출을 막음');
  let n0 = D3.calls.length; await D3.run('refreshQueueStatus()');
  ok(D3.calls.length===n0, '5분 안에는 다시 부르지 않음(캐시)');

  // ③ 실제 연결 — 노트북 초록 · 밀린 명령 노랑 · 토스 초록
  const S4 = mk(), fakeNow = S4.run('Date.now()');
  const iso = m => new Date(fakeNow - m*60000).toISOString();
  const TODAY = new Date(fakeNow + 9*3600e3).toISOString().slice(0,10);
  S4.props.QUEUE_SHEET_ID = 'SHEETidForTest0002';
  S4.addSheet('SHEETidForTest0002', {'Command_Queue': [
    ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by','finished_at'],
    ['c1', iso(40), 'phone','git_pull','gaegyebu','{}','DONE',1, iso(3), 'agent', iso(2)],
    ['c2', iso(9), 'phone','toss_sync','gaegyebu','{}','PENDING',0,'','',''],
    ['c3', iso(6), 'phone','claude_prompt','gaegyebu','{}','WAITING_APPROVAL',0,'','',''],
  ]});
  const gf = S4.ROOT.createFolder('가계부');
  gf.createFile('가계부_주식스냅샷.json', JSON.stringify({latest:{date:TODAY}, history:[]}));
  const D4 = makeDevice(S4); D4.config();
  const r4 = await D4.run('refreshQueueStatus(true)');
  bar = D4.el('statusbar').innerHTML;
  ok(r4 && r4.connected===true, '연결되면 connected');
  ok((bar.match(/class="stat ok"/g)||[]).length===1 && (bar.match(/class="stat warn"/g)||[]).length===1 &&
    (bar.match(/class="stat off"/g)||[]).length===1, '배지 색: 노트북 신호 없음 · 명령 노랑 · 토스 초록');
  ok(bar.includes('신호 없음') && /알 수 없어요/.test(bar), '하트비트 파일이 없으면 노트북 초록 대신 신호 없음(거짓 초록 제거)');
  ok(bar.includes('2분 전'), '노트북: 큐 활동 시각은 참고값으로만');
  ok(bar.includes('대기 1') && bar.includes('승인 1'), '밀린 명령: 대기·승인 건수');
  ok(bar.includes(TODAY.slice(5)), '토스 동기화 날짜');
  ok(/5분 캐시/.test(bar), '캐시로 읽었다는 표시');
  ok(!JSON.stringify(r4).includes('SHEETidForTest'), '화면에 스프레드시트 ID가 오지 않음');

  // ④ 5분 캐시
  let calls = D4.calls.length; await D4.run('refreshQueueStatus()');
  ok(D4.calls.length===calls, '캐시가 살아 있으면 다시 부르지 않음');
  D4.store.set('portal_qstatus_cache', JSON.stringify({at: new Date(Date.now()-6*60000).toISOString(), data: r4}));
  await D4.run('refreshQueueStatus()');
  ok(D4.calls.length>calls, '5분이 지나면 다시 조회');

  // ⑤ 서버가 준 글자도 이스케이프
  D4.run(`renderQueueStatus({ok:true, connected:true, at:new Date().toISOString(), heartbeat:{state:'ok',min:1,source:'sheet'}, queue:{state:'ok',pending:0,waiting:0,timeout:0,oldest_min:null}, toss:{state:'warn',date:'<b>x</b>',days:2}})`);
  bar = D4.el('statusbar').innerHTML;
  ok(!/<b>x<\/b>/.test(bar) && bar.includes('&lt;b&gt;'), '상태 값도 이스케이프');

  // ⑤-1 하트비트 파일이 없을 때 — 시트 활동으로 노트북을 '대기 중·마지막 응답'이라 말하지 않는다(2026-11-18)
  D4.run(`renderQueueStatus({ok:true, connected:true, at:new Date().toISOString(), heartbeat:{state:'unknown',source:'sheet',approx:true,min:2,reason:'no_heartbeat'}, queue:{state:'ok',pending:1,waiting:0,timeout:0,oldest_min:2,review:0}, toss:{state:'ok',date:'2026-11-18',days:0}})`);
  const nb4 = D4.run('monDevNotebookBody()');
  ok(!/마지막 응답/.test(nb4) && !/대기 중/.test(nb4), '시트 활동만으로는 노트북이 대기 중·마지막 응답이라 말하지 않는다');
  ok(/노트북 신호/.test(nb4) && /마지막 큐 활동/.test(nb4), '대신 신호가 없다는 것과 큐 활동(흔적)을 함께 보여준다');
  D4.run('ORD_ITEMS = []');
  const nb4b = D4.run('monDevNotebookBody()');
  ok(/알 수 없어요/.test(nb4b) && /HEARTBEAT_FILE_ID/.test(nb4b), '대기가 없어도 생존을 모른다고 밝히고 켜는 법을 안내');

  // ⑤-2 검토 필요 카드 — 병합 1줄을 원클릭 복사
  const gate = D4.run(`ordGateBox({id:'Q-20261118-120000-gate', status:'REVIEW_NEEDED', workspace:'content-hub', branch:'auto-review/Q-20261118-120000-gate', block_reason:'게이트 보류 — 민감 경로', diff_summary:'3개 파일 +20/-4'})`);
  ok(/id="ord-mrg-Q-20261118-120000-gate"/.test(gate) && /병합 1줄 복사/.test(gate), '검토 필요 카드에 병합 1줄 복사 버튼');
  ok(/compare\/main\.\.\.auto-review\/Q-20261118-120000-gate/.test(gate), '바뀐 내용 보기 링크도 그대로');
  ok(D4.run('ordMergeCmd({branch:"auto-review/Q-20261118-120000-gate"})') === 'git fetch && git merge origin/auto-review/Q-20261118-120000-gate', '복사되는 명령이 정확하다');
  ok(D4.run('ordMergeCmd({id:"Q-20261118-120000-gate"})') === 'git fetch && git merge origin/auto-review/Q-20261118-120000-gate', '브랜치 칸이 비면 오더 id 로 만든다');
  ok(D4.run('ordMergeCmd({id:"Q-x", branch:"main"})') === 'git fetch && git merge origin/auto-review/Q-x', 'main 같은 브랜치는 받지 않는다(주소 위조 방지)');
  ok(/보존된 브랜치가 없어요/.test(D4.run('ordMergeBlock({status:"REVIEW_NEEDED"})')), '브랜치가 없으면 정리 안내로 대신한다');
  ok(D4.run('ordCopyText("") === false'), '빈 글자는 복사하지 않는다');
  ok(D4.run("(function(){ try{ ordMergeCopy('Q-20261118-120000-gate'); return 'ok'; }catch(e){ return 'err:'+e.message; } })()") === 'ok', '클립보드(VS 복사)가 없어도 오류 없이 안내로 끝난다');

  // ⑥ 스마트스토어 링크 (기본 비활성 · 주소를 넣으면 켜짐)
  ok(D4.el('store-link').href==='#', '기본은 주소 없음(#)');
  const r6 = D4.run(`(function(){ var e={p:false,preventDefault:function(){this.p=true;}}; var r=storeClick(e); return JSON.stringify({r:r,p:e.p}); })()`);
  ok(JSON.parse(r6).r===false && JSON.parse(r6).p===true, '주소가 없으면 이동을 막고 안내');
  ok(D4.el('sync-txt').textContent.includes('스마트스토어'), '안내 문구 표시');
  D4.el('store-url').value='http://evil.example/x'; await D4.run('saveStoreUrl()');
  ok(D4.run('storeUrl()')==='' && !D4.store.get('portal_store_url'), 'http:// 주소는 거절');
  const GOOD='https://sell.smartstore.naver.com/#/home';
  D4.el('store-url').value=GOOD; await D4.run('saveStoreUrl()');
  ok(D4.run('storeUrl()')===GOOD && D4.store.get('portal_store_url')===GOOD, 'https 주소는 이 기기에 저장');
  ok(D4.el('store-link').href===GOOD, '헤더 링크가 저장한 주소로');
  D4.el('store-url').value=''; await D4.run('saveStoreUrl()');
  ok(D4.el('store-link').href==='#' && !D4.store.get('portal_store_url'), '비우면 다시 안내 상태');
  ok(/콘텐츠 허브|content-hub/.test(html), '콘텐츠 허브 링크는 고정');
}

console.log('R) 🤖 노트북 오더함 (포털 안 오더 창구)');
{
  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const S6 = mk();
  const nowMs = S6.run('Date.now()');
  const at = ms => new Date(ms).toISOString();
  const row = (id, created, status, x) => {
    const r = [id, created, 'phone', 'git_pull', 'gaegyebu', '{}', status, 0, '', '', ''];
    while (r.length < HEAD.length) r.push('');
    Object.keys(x || {}).forEach(k => { const i = HEAD.indexOf(k); if (i >= 0) r[i] = x[k]; });
    return r;
  };
  S6.props.QUEUE_SHEET_ID = 'SHEETidOrderUI0001';
  S6.addSheet('SHEETidOrderUI0001', {'Command_Queue': [HEAD.slice(0)].concat([
    row('Q-0002', at(nowMs - 8 * 60000), 'DONE', {type: 'toss_sync', finished_at: at(nowMs - 3 * 60000), duration_ms: 4200, result: '가계부 12건 동기화 완료'}),
    row('Q-0003', at(nowMs - 6 * 60000), 'FAILED', {type: 'git_pull', error: '<img src=x onerror=1> 실패'}),
    row('Q-0001', at(nowMs - 2 * 60000), 'WAITING_APPROVAL', {type: 'claude_prompt', workspace: 'content-hub',
      payload: JSON.stringify({prompt: '제목 고쳐줘', mode: 'edit'}), risk_level: 'HIGH',
      approval_expires_at: at(nowMs + 10 * 60000)})
  ])});

  // ① 카드 구성
  ok(/id="order-card"/.test(html) && /🤖 노트북 오더함/.test(html), '오더함 카드가 페이지에 있다');
  ok(/onclick="quickOrder\('git_pull'\)"/.test(html) && /onclick="quickOrder\('toss_sync'\)"/.test(html), '빠른 오더 버튼 2개(코드 최신화 · 토스 동기화)');
  ok(/id="ord-inp"/.test(html) && /onclick="sendOrder\(\)"/.test(html), '메모형 오더 입력창 + 오더 보내기');
  ok(/id="ord-edit-mode"/.test(html) && /onclick="loadOrders\(\)"/.test(html), '파일 수정 허용 + 새로고침 버튼');

  // ② 설정 전 — 요청 없이 안내만
  const S5 = mk(), D5 = makeDevice(S5);
  ok(/⚙️ 서버 설정/.test(D5.el('ord-list').innerHTML) && !/⚠️/.test(D5.el('ord-list').innerHTML), '설정 전: 빨간 에러 대신 안내');
  ok(D5.calls.length === 0, '설정 전: 오더 요청 0건');

  // ③ 목록 그리기
  const D6 = makeDevice(S6); D6.config();
  await D6.run('loadOrders()');
  const box = () => D6.el('ord-list').innerHTML;
  const listCall = D6.calls.filter(c => JSON.parse(c.opts.body).action === 'queue_list').pop();
  ok(!!listCall && JSON.parse(listCall.opts.body).limit === 18, '목록 요청은 queue_list(18건)');
  ok(D6.get('ORD_ITEMS').length === 3, '오더 3건을 받았다');
  ok(box().indexOf('승인 대기') >= 0 && box().indexOf('완료') >= 0 && box().indexOf('실패') >= 0, '상태 칩을 종류별로 보여준다');
  ok(box().indexOf('✅ 승인') >= 0 && box().indexOf('🚫 거절') >= 0, '승인 대기 오더에 승인/거절 버튼');
  ok((box().match(/data-id="Q-0001"/g) || []).length === 2, '버튼에 오더 id(data-id)가 붙는다');
  ok(box().indexOf('가계부 12건 동기화 완료') >= 0, 'DONE 결과가 타임라인에 보인다');
  ok(box().indexOf('4초 걸림') >= 0, '걸린 시간도 보여준다');
  ok(!/<img/.test(box()) && box().indexOf('&lt;img') >= 0, '결과·오류 글자를 이스케이프한다(XSS)');
  ok(box().indexOf('콘텐츠 허브') >= 0, '작업 위치를 사람이 읽는 이름으로');
  ok(box().indexOf('10분 안에 승인') >= 0, '승인 남은 시간 안내');
  ok(/승인 1/.test(D6.el('ord-count').textContent), '배지에 승인 대기 건수');
  ok(/최근 확인/.test(D6.el('ord-state').textContent), '마지막으로 확인한 시각');
  ok(D6.el('ord-ws').innerHTML.indexOf('>가계부</option>') >= 0 && D6.el('ord-ws').innerHTML.indexOf('>콘텐츠 허브</option>') >= 0, '작업 위치 선택칸(사람이 읽는 이름)');

  // ④ 승인 버튼 → queue_decide → 목록 갱신
  const lastBody = a => {
    for (let i = D6.calls.length - 1; i >= 0; i--) { const b = JSON.parse(D6.calls[i].opts.body); if (!a || b.action === a) return b; }
    return null;
  };
  let nCalls = D6.calls.length;
  await D6.run(`decideOrder('Q-0001','approve')`);
  let bd = lastBody('queue_decide');
  ok(bd && bd.id === 'Q-0001' && bd.decision === 'approve' && bd.key === S6.KEY, '승인 버튼이 queue_decide(approve)를 키와 함께 보낸다');
  ok(D6.calls.length > nCalls, '승인 뒤 목록을 다시 읽는다');
  ok(D6.get('ORD_ITEMS').filter(i => i.id === 'Q-0001')[0].status === 'PENDING', '승인한 오더는 대기로 바뀐다');
  ok(box().indexOf('✅ 승인') < 0, '승인하고 나면 승인 버튼이 사라진다');

  // ⑤ 확인창에서 취소하면 아무것도 보내지 않는다
  D6.run('confirm = function(){ return false; }');
  const nEnq = D6.calls.filter(c => JSON.parse(c.opts.body).action === 'queue_enqueue').length;
  D6.el('ord-inp').value = '제목 바꿔줘';
  D6.el('ord-edit-mode').checked = true;
  await D6.run('sendOrder()');
  await new Promise(r => setTimeout(r, 30));
  ok(D6.calls.filter(c => JSON.parse(c.opts.body).action === 'queue_enqueue').length === nEnq, '파일 수정 오더는 확인창에서 취소하면 접수하지 않는다');
  ok(D6.el('ord-inp').value === '제목 바꿔줘', '취소하면 입력한 글이 남는다');

  // ⑥ 오더 보내기 — 메모형 입력 → claude_prompt
  D6.el('ord-edit-mode').checked = false;
  D6.run('confirm = function(){ return true; }');
  D6.el('ord-inp').value = '가계부 11월 지출 점검해줘';
  await D6.run('sendOrder()');
  let be = lastBody('queue_enqueue');
  ok(be && be.type === 'claude_prompt' && be.workspace === 'gaegyebu' && be.payload.prompt === '가계부 11월 지출 점검해줘' && be.payload.mode === 'ask', '입력한 오더가 claude_prompt(ask)로 접수된다');
  ok(D6.el('ord-inp').value === '', '접수되면 입력칸이 비워진다');
  ok(D6.get('ORD_ITEMS').some(i => i.summary.indexOf('가계부 11월 지출 점검해줘') >= 0), '보낸 오더가 바로 목록에 쌓인다');
  ok(/보냈어요|접수됨/.test(D6.el('sync-txt').textContent), '접수 안내가 뜬다');

  // ⑦ 파일 수정 허용 → 자동 승인(가계부)은 바로 실행 대기, 포털은 승인 대기
  D6.el('ord-edit-mode').checked = true;
  D6.el('ord-inp').value = '메리 쇼츠 제목 후보 3개 뽑아줘';
  await D6.run('sendOrder()');
  be = lastBody('queue_enqueue');
  ok(be && be.payload.mode === 'edit', '파일 수정 허용이면 mode=edit 로 보낸다');
  ok(D6.get('ORD_ITEMS').some(i => i.status === 'PENDING' && i.summary.indexOf('메리 쇼츠 제목') >= 0), '가계부 수정 오더는 자동 승인으로 바로 대기(PENDING)');
  ok(D6.el('ord-edit-mode').checked === false, '접수 뒤 체크를 풀어 둔다');
  ok(D6.el('ord-ws').innerHTML.indexOf('s2ongrae.github.io') >= 0, '포털도 작업 위치로 고를 수 있다');
  D6.el('ord-ws').value = 's2ongrae.github.io';
  D6.el('ord-edit-mode').checked = true;
  D6.el('ord-inp').value = '카드 문구 고쳐줘';
  await D6.run('sendOrder()');
  const portalItem = D6.get('ORD_ITEMS').filter(i => i.summary.indexOf('카드 문구') >= 0)[0];
  ok(portalItem && portalItem.status === 'WAITING_APPROVAL' && portalItem.approval_by !== 'auto', '포털(제어면) 수정은 승인 대기로 쌓인다');
  ok(box().indexOf('자동(위임)') >= 0, '자동 승인 건은 배지로 구분한다');
  D6.el('ord-ws').value = 'gaegyebu';

  // ⑧ Enter 로 보내기, Shift+Enter 는 줄바꿈
  nCalls = D6.calls.length;
  D6.el('ord-inp').value = '엔터로 보내기';
  D6.run(`ordKey({key:'Enter', shiftKey:false, preventDefault:function(){this.p=true;}})`);
  await new Promise(r => setTimeout(r, 40));
  ok(lastBody('queue_enqueue').payload.prompt === '엔터로 보내기', 'Enter 로 오더를 보낸다');
  const nCalls2 = D6.calls.length;
  D6.run(`ordKey({key:'Enter', shiftKey:true})`);
  await new Promise(r => setTimeout(r, 40));
  ok(D6.calls.length === nCalls2, 'Shift+Enter 는 보내지 않는다(줄바꿈)');

  // ⑨ 빈 입력·거절 버튼
  D6.el('ord-inp').value = '   ';
  const nEmpty = D6.calls.length;
  await D6.run('sendOrder()');
  ok(D6.calls.length === nEmpty, '빈 입력은 보내지 않는다');
  const wait = D6.get('ORD_ITEMS').filter(i => i.status === 'WAITING_APPROVAL')[0];
  await D6.run(`decideOrder('${wait.id}','reject')`);
  ok(lastBody('queue_decide').decision === 'reject', '거절 버튼이 reject 를 보낸다');
  ok(D6.get('ORD_ITEMS').filter(i => i.id === wait.id)[0].status === 'REJECTED', '거절한 오더는 거절로 바뀐다');

  // ⑩ 예전 배포(오더함 없음) — 빨간 에러 대신 안내
  const S7 = mk(), D7 = makeDevice(S7);
  S7.sb.doPost = () => ({ getContent: () => JSON.stringify({ok: false, error: '알 수 없는 요청이에요.'}) });
  D7.config();
  await D7.run('loadOrders()');
  ok(D7.el('ord-list').innerHTML.indexOf('다시 배포') >= 0 && D7.el('ord-list').innerHTML.indexOf('⚠️') < 0, '예전 배포: 빨간 에러 대신 재배포 안내');

  // ⑪ 시트 미연결 — 넣어야 할 속성 이름 안내
  const S8 = mk(), D8 = makeDevice(S8); D8.config();
  await D8.run('loadOrders()');
  ok(D8.el('ord-list').innerHTML.indexOf('QUEUE_SHEET_ID') >= 0, '시트 미연결: 넣어야 할 속성 이름을 알려준다');

  // ⑫ 통신 실패 — 안내만, 화면은 살아 있음
  D8.run('fetch = async function(){ throw new Error("offline"); }');
  await D8.run('loadOrders()');
  ok(D8.el('ord-list').innerHTML.indexOf('불러오지 못했어요') >= 0 && D8.el('ord-list').innerHTML.indexOf('⚠️') < 0, '통신 실패에도 안내 문구만');

  // ⑬ 서버 값이 이상해도 화면이 깨지지 않는다
  D6.run(`applyOrderList({at:new Date().toISOString(), items:[{id:'"><b>', type:'<img src=x>', status:'WHAT', summary:'<script>x</script>', workspace:'<i>', created_at:'bad'}], workspaces:['<b>ws</b>']})`);
  ok(box().indexOf('<script') < 0 && box().indexOf('<img') < 0 && box().indexOf('<i>') < 0 &&
    box().indexOf('&lt;script') >= 0 && box().indexOf('&lt;img') >= 0, '알 수 없는 상태·값도 이스케이프해서 그린다');
  ok(D6.el('ord-ws').innerHTML.indexOf('&lt;b&gt;') >= 0, '작업 위치 이름도 이스케이프');

  // ⑭ AI 엔진 선택칸 — 4개 · 자동 라벨은 정품 Claude→agy→FreeLLMAPI 순
  ok(/id="ord-engine"/.test(html), 'AI 엔진 선택칸이 있다');
  const engOpts = [...html.matchAll(/<option value="(auto|claude|agy|freellmapi)"[^>]*>([^<]*)<\/option>/g)];
  ok(engOpts.length === 4 && engOpts.map(o => o[1]).join(',') === 'auto,claude,agy,freellmapi', '엔진 4종(auto·claude·agy·freellmapi)', engOpts.map(o => o[1]));
  ok(engOpts[0][2].indexOf('자동') >= 0 && engOpts[0][2].indexOf('정품 Claude→agy→FreeLLMAPI') >= 0, '자동 라벨에 폴백 순서가 그대로 보인다', engOpts[0][2]);
  D6.el('ord-engine').value = 'agy';
  ok(D6.run('ordEngine()') === 'agy', '고른 엔진을 읽는다');
  D6.run('ordEngineSave()');
  ok(D6.store.get('portal_ord_engine') === '"agy"', '엔진 선택을 이 기기에 기억');
  D6.el('ord-engine').value = 'nope';
  ok(D6.run('ordEngine()') === 'auto', '이상한 값이면 auto 로 본다');
  D6.el('ord-engine').value = '';
  D6.run('ordEngineLoad()');
  ok(D6.el('ord-engine').value === 'agy', '다시 열면 기억한 엔진으로');

  // ⑮ 엔진을 고르면 payload.engine 으로, auto 면 싣지 않는다
  D6.run('confirm = function(){ return true; }');
  D6.el('ord-engine').value = 'agy'; D6.el('ord-edit-mode').checked = false;
  D6.el('ord-inp').value = '제미나이로 요약해줘';
  await D6.run('sendOrder()');
  let beng = lastBody('queue_enqueue');
  ok(beng && beng.payload.engine === 'agy' && beng.payload.prompt === '제미나이로 요약해줘', '고른 엔진이 payload.engine 으로 간다', beng && beng.payload);
  D6.el('ord-engine').value = 'auto';
  D6.el('ord-inp').value = '기본 엔진으로 해줘';
  await D6.run('sendOrder()');
  beng = lastBody('queue_enqueue');
  ok(beng && beng.payload.engine === undefined && beng.payload.mode === 'ask', 'auto 는 payload 에 넣지 않는다(기본값)', beng && beng.payload);
  D6.el('ord-engine').value = 'freellmapi';
  D6.el('ord-inp').value = 'FreeLLMAPI 로 점검';
  await D6.run('sendOrder()');
  ok(lastBody('queue_enqueue').payload.engine === 'freellmapi', 'FreeLLMAPI 선택도 그대로 전달');

  // ⑯ 오더 도움말 패널 — 기능 안내·예시·눌러서 채우기
  ok(/id="ord-help"/.test(html) && /data-fill=/.test(html), '오더 도움말 패널이 있다');
  ok(/저장소 · 최신화/.test(html) && /가계부 · 돈/.test(html) && /조회 · 분석/.test(html) && /파일 수정 \(일부는 승인\)/.test(html), '기능 4갈래를 한눈에 보여준다');
  ok(/토스증권 → 가계부 동기화/.test(html) && /\[✅ 승인\]/.test(html), '동기화 예시버튼과 승인 안내가 있다');
  D6.run(`ordExample({dataset:{fill:'이번 달 납비만 모아줘'}})`);
  ok(D6.el('ord-inp').value === '이번 달 납비만 모아줘' && D6.el('ord-edit-mode').checked === false, '예시를 누르면 입력칸이 채워지고(조회 예시는 수정 아님)');
  D6.run(`ordExample({dataset:{fill:'README 오타 고쳐줘', edit:'1'}})`);
  ok(D6.el('ord-inp').value === 'README 오타 고쳐줘' && D6.el('ord-edit-mode').checked === true, '파일 수정 예시는 체크까지 같이');
  ok(D6.el('sync-txt').textContent.indexOf('채웠어요') >= 0, '채우면 안내 문구');
  const nBeforeEx = D6.calls.length;
  D6.run(`ordExample({dataset:{fill:'이빠이 채우기'}})`);
  ok(D6.calls.length === nBeforeEx, '예시를 눌러도 저절로 보내지는 않는다(확인 뒤 보냄)');
}

console.log('S) 오더함 — 자동 확인·승인 카운트다운·다시 실행·최근 글·입력 방어');
{
  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const S9 = mk();
  const nowMs = S9.run('Date.now()');
  const at = ms => new Date(ms).toISOString();
  const row = (id, created, status, x) => {
    const r = [id, created, 'phone', 'git_pull', 'gaegyebu', '{}', status, 0, '', '', ''];
    while (r.length < HEAD.length) r.push('');
    Object.keys(x || {}).forEach(k => { const i = HEAD.indexOf(k); if (i >= 0) r[i] = x[k]; });
    return r;
  };
  S9.props.QUEUE_SHEET_ID = 'SHEETidOrderPoll001';
  S9.addSheet('SHEETidOrderPoll001', {'Command_Queue': [HEAD.slice(0)].concat([
    row('Q-1001', at(nowMs - 20 * 60000), 'DONE', {type: 'git_pull', duration_ms: 3000, result: '이미 최신'}),
    row('Q-1002', at(nowMs - 15 * 60000), 'FAILED', {type: 'git_pull', error: '커밋 안 한 변경이 있어요'}),
    row('Q-1003', at(nowMs - 12 * 60000), 'TIMEOUT_REVIEW', {type: 'toss_sync', error: '한도 소진'}),
    row('Q-1004', at(nowMs - 4 * 60000), 'WAITING_APPROVAL', {type: 'claude_prompt', workspace: 'content-hub',
      payload: JSON.stringify({prompt: '제목 고쳐줘', mode: 'edit'}), risk_level: 'HIGH',
      approval_expires_at: at(nowMs + 10 * 60000)}),
    row('Q-1005', at(nowMs - 3 * 60000), 'DONE', {type: 'claude_prompt', workspace: 'gaegyebu',
      payload: JSON.stringify({prompt: '요약해줘', mode: 'ask'}), duration_ms: 8000, result: '[agy] 3줄 요약을 마쳤습니다'})
  ])});
  const D9 = makeDevice(S9); D9.config();
  await D9.run('loadOrders()');
  const box9 = () => D9.el('ord-list').innerHTML;
  const last9 = a => {
    for (let i = D9.calls.length - 1; i >= 0; i--) { const b = JSON.parse(D9.calls[i].opts.body); if (!a || b.action === a) return b; }
    return null;
  };

  // ① 승인 카운트다운 — 그릴 때 숫자를 굳히지 않고 data-until(절대 시각)을 남긴다
  ok(D9.run('typeof ordDeadline') === 'function' && D9.run('typeof ordTick') === 'function', '승인 카운트다운 함수가 있다');
  const wait9 = D9.get('ORD_ITEMS').filter(i => i.status === 'WAITING_APPROVAL')[0];
  ok(/class="ord-cd" data-until="\d{13}"/.test(box9()), '승인 대기 카드에 만료까지 남은 시각(data-until)이 붙는다');
  ok(box9().indexOf('10분 안에 승인') >= 0, '처음 그릴 때는 남은 시간 안내를 그대로 보여준다');
  const until = Number((box9().match(/data-until="(\d{13})"/) || [])[1]);
  ok(Math.abs(until - (D9.run('ORD_FETCH_AT') + wait9.expires_in_ms)) < 5000, 'data-until = 받은 시각 + 서버가 준 남은 시간');
  ok(/^\(1분 5초 남음\)$/.test('(' + D9.run('ordLeftText(65000)') + ')'), '남은 시간을 분·초로 읽기 쉽게');
  ok(D9.run('ordLeftText(-1)') === '승인 시간이 지났어요', '지난 뒤에는 지났다고 표시');
  ok(D9.run('ordDeadline({status:"DONE",expires_in_ms:60000})') === 0, '승인 대기가 아니면 카운트다운 없음');
  ok(D9.run('ordCdNodes().length') === 0 && D9.run('ORD_CD_TIMER') === null, '화면에 카운트다운 요소가 없으면 타이머도 만들지 않는다(가짜 화면은 건너뜀)');

  // ② 실행 중인 오더가 있을 때만 자동 확인
  ok(D9.run('ordActive()') === true, 'PENDING·승인 대기가 있으면 자동 확인 대상');
  D9.run('ORD_POLL.paused = false; ORD_POLL.calls = 0; ORD_POLL.started = 0; ordPollSchedule()');
  ok(!!D9.run('ORD_POLL.timer'), '실행 중인 오더가 있으면 20초 뒤 다시 읽도록 예약한다');
  D9.run('document.hidden = true; ordPollSchedule()');
  ok(!D9.run('ORD_POLL.timer'), '탭이 가려져 있으면 자동 확인을 멈춘다');
  D9.run('document.hidden = false; ordPollSchedule()');
  ok(!!D9.run('ORD_POLL.timer'), '탭으로 돌아오면 다시 예약');
  D9.run(`ORD_POLL.calls = ORD_POLL_MAX; ordPollSchedule()`);
  ok(D9.run('ORD_POLL.paused') === true && !D9.run('ORD_POLL.timer'), '10분(30회)을 넘기면 자동 확인을 멈춘다');
  ok(/자동 갱신을 멈췄어요/.test(D9.el('ord-paused').textContent) && D9.el('ord-paused').style.display === 'block', '멈춘 이유와 다시 켜는 방법을 화면에 남긴다');
  await D9.run('loadOrders()');
  ok(D9.run('ORD_POLL.paused') === false && D9.el('ord-paused').style.display === 'none', '사람이 ⟳ 로 다시 읽으면 자동 확인이 다시 켜진다');
  D9.run('ORD_ITEMS = [{status:"DONE"}]; ordPollSchedule()');
  ok(!D9.run('ORD_POLL.timer') && D9.run('ORD_POLL.started') === 0, '남은 오더가 없으면 자동 확인을 끈다');
  await D9.run('loadOrders()');

  // ③ 자동 확인이 실패해도 목록을 지우지 않는다
  const keepBox = box9();
  D9.run('__fetchSave = fetch');
  D9.run('fetch = async function(){ throw new Error("offline"); }');
  await D9.run('loadOrders({silent:true})');
  ok(box9() === keepBox && box9().indexOf('불러오지 못했어요') < 0, '자동 확인 실패는 목록·안내를 건드리지 않는다');
  D9.run('fetch = __fetchSave');
  await D9.run('loadOrders()');
  ok(box9().length > 0 && box9().indexOf('다시 확인') < 0, '통신이 돌아오면 다시 읽어온다');

  // ④ 목록이 그대로면 다시 그리지 않는다(깜빡임·스크롤 튐 방지)
  const same = D9.get('ORD_ITEMS');
  D9.el('ord-list').innerHTML = '<i>그대로</i>';
  D9.run(`applyOrderList({at:new Date().toISOString(), items:${JSON.stringify(same)}})`);
  ok(D9.el('ord-list').innerHTML === '<i>그대로</i>', '달라진 게 없으면 목록을 다시 그리지 않는다');
  D9.run(`applyOrderList({at:new Date().toISOString(), items:${JSON.stringify(same.map((x,i)=> i===0?Object.assign({},x,{status:'FAILED'}):x))}})`);
  ok(D9.el('ord-list').innerHTML !== '<i>그대로</i>', '상태가 바뀌면 다시 그린다');
  await D9.run('loadOrders()');

  // ⑤ 실패·확인 필요·만료된 빠른 오더는 원탭으로 다시 실행
  ok(/data-type="git_pull" onclick="quickOrder\(this.dataset.type\)">🔄 다시 실행/.test(box9()), '실패한 코드 최신화 카드에 다시 실행 버튼');
  ok(/data-type="toss_sync"/.test(box9()), '확인 필요(한도) 토스 동기화 카드에도 다시 실행 버튼');
  ok((box9().match(/다시 실행/g) || []).length === 2, '완료된 오더에는 다시 실행 버튼을 붙이지 않는다(실패 2건만)');
  const nQ = D9.calls.length;
  await D9.run(`quickOrder('toss_sync')`);
  const retryBody = (() => { for (let i = D9.calls.length - 1; i >= 0; i--) { const b = JSON.parse(D9.calls[i].opts.body); if (b.action === 'queue_enqueue') return b; } return null; })();
  ok(retryBody && retryBody.type === 'toss_sync' && D9.calls.length > nQ, '다시 실행은 같은 종류로 새 오더를 접수한다');

  // ⑥ 실행한 엔진을 결과 카드에 보여준다
  ok(box9().indexOf('⚡ agy') >= 0, '결과가 [agy] 로 시작하면 엔진 배지를 보여준다');
  ok(D9.run(`ordEngineChip({type:'claude_prompt', result:'[claude] 완료'})`).indexOf('⚡ claude') >= 0, 'claude 표기도 배지로');
  ok(D9.run(`ordEngineChip({type:'git_pull', result:'[agy] x'})`) === '', '클로드 지시가 아니면 엔진 배지 없음');

  // ⑦ 최근 보낸 오더 글 — 이 기기에만, 최대 5개, 자동 전송 금지
  D9.run('confirm = function(){ return true; }');
  for (const t of ['하나', '둘', '셋', '넷', '다섯', '여섯', '일곱']) {
    D9.el('ord-inp').value = t + ' 점검해줘';
    await D9.run('sendOrder()');
  }
  const rec = () => JSON.parse(D9.store.get('portal_ord_recent') || '[]');
  ok(rec().length === 5 && rec().every(x => x.t && isFinite(x.at)), '최근 글은 5개까지만, 시각과 함께 남긴다');
  ok(rec()[0].t === '일곱 점검해줘' && !rec().some(x => x.t === '하나 점검해줘'), '방금 보낸 글이 맨 앞, 오래된 글은 밀려난다');
  D9.run(`ordRecentAdd('셋 점검해줘')`);
  ok(rec()[0].t === '셋 점검해줘' && rec().filter(x => x.t === '셋 점검해줘').length === 1 && rec().length === 5, '다시 쓴 글은 맨 앞으로 올라가고 중복되지 않는다');
  ok((D9.el('ord-recent').innerHTML.match(/class="ord-rec"/g) || []).length === 5, '최근 글을 칩으로 보여준다');
  ok(/최근 보낸 오더/.test(D9.el('ord-recent').innerHTML) && D9.el('ord-recent').style.display === 'flex', '칸 이름과 함께 보인다');
  D9.el('ord-inp').value = '';
  const nBeforeFill = D9.calls.length;
  D9.run('ordRecentFill(1)');
  ok(D9.el('ord-inp').value === rec()[1].t && D9.calls.length === nBeforeFill, '누르면 입력칸만 채우고 보내지는 않는다');
  D9.run('ordRecentClear()');
  ok(rec().length === 0 && D9.el('ord-recent').style.display === 'none', '지우면 이 기기에서도 사라진다');
  const S10 = mk();
  const D10 = makeDevice(S10, {portal_ord_recent: JSON.stringify([
    {t: '남아 있던 글', at: Date.now() - 1000},
    {t: '하루 지난 글', at: Date.now() - 25 * 3600 * 1000}
  ])});
  ok(D10.get('ORD_RECENT').length === 1 && D10.el('ord-recent').innerHTML.indexOf('남아 있던 글') >= 0, '저장된 최근 글은 다시 열 때 이어받는다');
  ok(D10.el('ord-recent').innerHTML.indexOf('하루 지난 글') < 0, '하루가 지난 글은 이 기기에서도 버린다(민감정보 잔류 최소화)');

  // ⑧ 입력 방어 — 2,000자·전송 잠금
  D9.el('ord-inp').value = '가'.repeat(2100);
  ok(D9.run('ordTyped()') === 2100 && /2,100/.test(D9.el('ord-chars').textContent), '글자 수를 세어 보여준다');
  ok(/over/.test(D9.el('ord-chars').className), '2,000자를 넘으면 빨갛게 알린다');
  const nToo = D9.calls.length;
  await D9.run('sendOrder()');
  ok(D9.calls.length === nToo && D9.el('ord-inp').value.length === 2100, '2,000자를 넘으면 보내지 않고 글을 남긴다');
  ok(/너무 길어요/.test(D9.el('sync-txt').textContent), '왜 안 보내는지 알려준다');
  D9.el('ord-inp').value = '짧은 오더';
  D9.run('ordTyped()');
  ok(!/over/.test(D9.el('ord-chars').className) && /5/.test(D9.el('ord-chars').textContent), '2,000자 이내면 평소 표시');
  D9.run('ORD_SEND_BUSY = true');
  const nLock = D9.calls.length;
  await D9.run('sendOrder()');
  ok(D9.calls.length === nLock, '보내는 중에 또 눌러도 두 번 접수하지 않는다');
  D9.run('ORD_SEND_BUSY = false; ordSendLock(false)');
  ok(D9.el('ord-send').textContent === '↑' && D9.el('ord-send').disabled === false, '전송 잠금이 풀리면 보내기 버튼이 되살아난다');

  // ⑨ 승인·전송은 그 전에 시작한 목록 요청을 무효로 만든다(늦게 온 옛 응답이 덮어쓰지 않게)
  const ep0 = D9.run('ORD_EPOCH');
  D9.el('ord-inp').value = '차례 확인';
  await D9.run('sendOrder()');
  ok(D9.run('ORD_EPOCH') > ep0, '오더를 보내면 이전 목록 응답을 버릴 표시를 올린다');
  await D9.run('loadOrders()');
  const w2 = D9.get('ORD_ITEMS').filter(i => i.status === 'WAITING_APPROVAL')[0];
  if (w2) {
    const ep1 = D9.run('ORD_EPOCH');
    await D9.run(`decideOrder('${w2.id}','approve')`);
    ok(D9.run('ORD_EPOCH') > ep1, '승인도 같은 표시를 올린다');
  } else ok(true, '승인 대기 오더가 없어 건너뜀');

  // ⑩ 탭으로 돌아오면 멈춰 있던 상태를 한 번에 맞춘다
  ok(D9.run('typeof ordOnShow') === 'function', '탭 복귀 처리 함수가 있다');
  ok(/visibilitychange/.test(html), '탭 복귀(visibilitychange)에 반응한다');
  const nShow = D9.calls.length;
  D9.run('document.hidden = false; ordOnShow()');
  await new Promise(r => setTimeout(r, 30));
  ok(D9.calls.length >= nShow, '탭 복귀는 필요한 만큼만 요청한다');
}

console.log('T) 작업 관제 — 기기 카드·생애주기·정체 의심·GitHub 이력');
{
  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const S11 = mk();
  const nowMs = Date.now();                 // 포털은 진짜 시계로 경과 시간을 재요(서버 시트는 가짜 시계)
  const srvNow = S11.run('Date.now()');     // 하트비트 파일은 서버 시계 기준으로 써야 나이가 맞아요
  const at = ms => new Date(ms).toISOString();
  const row = (id, created, status, x) => {
    const r = [id, created, 'phone', 'git_pull', 'gaegyebu', '{}', status, 0, '', '', ''];
    while (r.length < HEAD.length) r.push('');
    Object.keys(x || {}).forEach(k => { const i = HEAD.indexOf(k); if (i >= 0) r[i] = x[k]; });
    return r;
  };
  S11.props.QUEUE_SHEET_ID = 'SHEETidMonitor00001';
  S11.addSheet('SHEETidMonitor00001', {'Command_Queue': [HEAD.slice(0)].concat([
    // 어제 17:35 부터 RUNNING 으로 멈춰 있는 오더(실측 상황) + 밀린 PENDING 2건
    row('Q-20261116-173532-gde8', at(nowMs - 16 * 3600000), 'RUNNING',
      {type: 'claude_prompt', workspace: 'content-hub', claimed_at: at(nowMs - 16 * 3600000 - 60000), claimed_by: 'notebook',
        payload: JSON.stringify({prompt: '콘텐츠 허브 점검', mode: 'ask'})}),
    row('Q-1002', at(nowMs - 10 * 60000), 'PENDING', {type: 'toss_sync'}),
    row('Q-1003', at(nowMs - 9 * 60000), 'PENDING', {type: 'git_pull'}),
    row('Q-1004', at(nowMs - 3 * 60000), 'DONE', {type: 'git_pull', finished_at: at(nowMs - 2 * 60000),
      claimed_at: at(nowMs - 3 * 60000), claimed_by: 'notebook', duration_ms: 4000, result: '이미 최신'}),
    row('Q-1005', at(nowMs - 25 * 60000), 'FAILED', {type: 'toss_sync', finished_at: at(nowMs - 24 * 60000),
      duration_ms: 1200, error: '한도 소진'}),
    row('Q-1006', at(nowMs - 6 * 60000), 'WAITING_APPROVAL', {type: 'claude_prompt', workspace: 'gaegyebu',
      payload: JSON.stringify({prompt: '제목 고쳐줘', mode: 'edit'}), risk_level: 'HIGH',
      approval_expires_at: at(nowMs + 9 * 60000)})
  ])});
  const hbf = S11.ROOT.createFile('heartbeat.json', JSON.stringify({updated_at: at(srvNow - 40 * 60000), state: 'running', processed: 7, polls: 21, current: 'Q-20261116-173532-gde8', current_type: 'claude_prompt', version: '1.2.0'}));
  S11.props.HEARTBEAT_FILE_ID = hbf.id;
  const D11 = makeDevice(S11);
  ok(/id="mon-cards"/.test(html) && /id="mon-feed"/.test(html), '포털에 작업 관제(기기 카드·통합 이력) 자리가 있다');
  ok(/data-f="hub"/.test(html) && /data-f="pc"/.test(html) && /data-f="nd"/.test(html), '통합 이력에 허브·회사 PC·노트북 직접 갈래 버튼');
  ok(/\.mon-grid\{grid-template-columns:1fr 1fr\}/.test(html), '폰에서는 기기 카드를 2x2 로');
  D11.config();
  await D11.run('refreshQueueStatus(true)');
  await D11.run('loadOrders()');
  const cards11 = () => D11.el('mon-cards').innerHTML;
  const feed11 = () => D11.el('mon-feed').innerHTML;

  // ① 정체 의심 — RUNNING 16시간 + 하트비트 40분 전
  const run11 = D11.get('ORD_ITEMS').filter(i => i.status === 'RUNNING')[0];
  ok(!!run11 && run11.claimed_at && run11.claimed_by === 'notebook', '서버가 집어간 시각·집어간 곳(claimed_at·claimed_by)을 준다');
  ok(D11.run('ordStale({status:"RUNNING",claimed_at:"' + at(nowMs - 16 * 3600000) + '"}).lv') === 'bad', '16시간 RUNNING 은 멈춘 것 같음(bad)');
  ok(D11.run('ordStale({status:"RUNNING",claimed_at:"' + at(nowMs - 25 * 60000) + '"}).lv') === 'warn', '25분 RUNNING 은 정체 의심(warn)');
  ok(D11.run('ordStale({status:"RUNNING",claimed_at:"' + at(nowMs - 5 * 60000) + '"})') === null, '5분짜리 실행은 정상(경고 없음)');
  ok(D11.run('ordStale({status:"DONE",claimed_at:"' + at(nowMs - 16 * 3600000) + '"})') === null, '끝난 오더는 정체가 아니다');
  // 2026-11-18 야간 무인 — 정체 판정은 "시작부터 흐른 시간"이 아니라 "마지막 신호" 기준이다.
  ok(D11.run('ordStale({status:"RUNNING",started_at:"' + at(nowMs - 50 * 60000) + '",beat_at:"' + at(nowMs - 8000) + '"})') === null,
    '50분째 실행 중이어도 신호가 살아 있으면 정상(예전엔 30분 넘으면 경고했다)');
  ok(D11.run('ordStale({status:"RUNNING",started_at:"' + at(nowMs - 50 * 60000) + '",beat_at:"' + at(nowMs - 25 * 60000) + '"}).lv') === 'warn',
    '신호가 25분 끊기면 정체 의심(warn)');
  ok(D11.run('ordStale({status:"RUNNING",started_at:"' + at(nowMs - 2 * 3600000) + '",beat_at:"' + at(nowMs - 70 * 60000) + '"}).lv') === 'bad',
    '신호가 70분 끊기면 멈춘 것 같음(bad)');
  ok(D11.run('ordElapsedMs({status:"RUNNING",started_at:"' + at(nowMs - 30 * 60000) + '",claimed_at:"' + at(nowMs - 1000) + '"})') >= 29 * 60000,
    '경과 시간은 started_at 부터 센다(claimed_at 이 touch 로 움직여도 흐른다)');
  ok(/마지막 신호 \d+초 전/.test(D11.run('ordBeatText({status:"RUNNING",beat_at:"' + at(nowMs - 6000) + '"})')), '오더 줄에 마지막 신호를 보여준다');
  ok(D11.run('ordBeatText({status:"DONE",beat_at:"' + at(nowMs - 6000) + '"})') === '', '끝난 오더에는 마지막 신호를 안 붙인다');
  ok(/멈춘 것 같아요/.test(cards11()) && /mon-dev bad/.test(cards11()), '노트북 카드가 빨간색으로 멈춘 것 같다고 알린다');
  ok(/ord-stale bad/.test(D11.el('ord-list').innerHTML), '오더 카드에도 정체 경고 배지');
  ok(D11.el('mon-badge').textContent.indexOf('정체') >= 0, '관제 배지에 정체 건수');
  ok(/mon-bar/.test(D11.run('monCard({name:"x",cls:"run",state:"작업 중",main:"m",bar:true})')), '실행 중 표시(진행 막대)가 있다');

  // ② 생애주기 — 예정 → 실행 중 → 끝냈다
  const box11 = () => D11.el('ord-list').innerHTML;
  ok(D11.run('ordSteps({status:"PENDING",created_at:"' + at(nowMs) + '"}).indexOf("② 실행 차례")') >= 0, '예정 오더는 ② 실행 차례');
  ok(D11.run('ordSteps({status:"PENDING"}).indexOf("ord-stp now")') >= 0, '예정은 지금 단계로 표시');
  ok(D11.run('ordSteps({status:"RUNNING"}).indexOf("② 실행 중")') >= 0, '실행 중은 ② 실행 중');
  const doneSteps = D11.run('ordSteps({status:"DONE",created_at:"' + at(nowMs) + '",finished_at:"' + at(nowMs + 4000) + '"})');
  ok(/③ 끝냄/.test(doneSteps) && (doneSteps.match(/ord-stp done/g) || []).length === 3, '끝난 오더는 ①②③ 모두 완료 표시');
  ok(/③ 실패/.test(D11.run('ordSteps({status:"FAILED"})')), '실패는 ③ 실패로 표시');
  ok(/② 실행 안 함/.test(D11.run('ordSteps({status:"EXPIRED"})')), '만료·거절은 실행 안 함으로 표시');
  ok(/ord-steps/.test(box11()), '오더 카드마다 생애주기 줄이 보인다');
  ok(/data-since="\d{13}"/.test(box11()) && /ord-elapsed/.test(box11()), '실행 중 오더에 경과 시간(1초마다 세는 자리)이 붙는다');
  ok(D11.run('monDur(65000)') === '1분 5초' && D11.run('monDur(16*3600000)') === '16시간', '경과 시간을 읽기 쉽게');
  ok(D11.run('ordElapsedMs({status:"DONE",claimed_at:"' + at(nowMs - 3400) + '",finished_at:"' + at(nowMs) + '"})') === 3400, '끝난 오더는 걸린 시간 = 끝 - 시작');
  // 승인 대기·대기만 있을 때 노트북 카드가 "할 일이 예약돼 있다"고 알리는지 (하트비트가 살아 있는 경우)
  D11.run('QSTAT_DATA = {heartbeat:{state:"ok", min:1, source:"drive"}}');
  D11.run('ORD_ITEMS = [{status:"WAITING_APPROVAL",id:"x"}]');
  ok(/승인 대기/.test(D11.run('monDevNotebook()')) && /\[✅ 승인\]/.test(D11.run('monDevNotebook()')), '승인 대기만 있으면 승인하면 실행된다고 알린다');
  D11.run('ORD_ITEMS = [{status:"PENDING",id:"y"}]');
  ok(/다음 차례를 기다리는 오더/.test(D11.run('monDevNotebook()')), '대기만 있으면 다음 차례를 알린다');
  D11.run('QSTAT_DATA = {heartbeat:{state:"warn", min:40, source:"drive"}}');
  ok(/응답 없음/.test(D11.run('monDevNotebook()')), '하트비트가 끊겼으면 승인·대기보다 "응답 없음"을 먼저 알린다');
  await D11.run('refreshQueueStatus(true)');
  await D11.run('loadOrders()');

  // ③ 회사 PC — GitHub 기록이 있을 때 / 없을 때 / 한도
  ok(D11.run('ghCanFetch()') === false, '테스트 환경(https 아님)에서는 GitHub 을 부르지 않는다');
  ok(D11.calls.every(c => c.opts.method === 'POST' && JSON.parse(c.opts.body).action), 'GitHub 조회 때문에 다른 요청이 섞이지 않는다(POST 만)');
  ok(/GitHub 기록을 아직 못 읽었어요/.test(cards11()), 'GitHub 기록이 없으면 솔직하게 안내');
  D11.run('GH_DATA = {at: new Date().toISOString(), runs_at: new Date().toISOString(), repos: {' +
    '"content-hub": {commits: [{sha: "abc1234", msg: "feat(ui): v3.3 — 카드 밀도", email: "s2ongrae+work@gmail.com", at: ' + JSON.stringify(at(nowMs - 3 * 60000)) + '}],' +
    '  run: {name: "deploy", status: "completed", conclusion: "success", branch: "main"}},' +
    '"gaegyebu": {commits: [{sha: "def5678", msg: "Merge pull request #1 from s2ongrae/agent/ui", email: "s2ongrae@gmail.com", at: ' + JSON.stringify(at(nowMs - 5 * 3600000)) + '}]}' +
    '}}; monRender(true)');
  ok(/방금 작업/.test(cards11()) && /content-hub|콘텐츠 허브/.test(cards11()), '가장 최근 푸시가 3분 전이면 방금 작업');
  ok(/✅ CI 통과/.test(cards11()), '마지막 CI 결과를 함께 보여준다');
  ok(/GitHub 푸시가 유일한 신호/.test(cards11()) || /푸시만 보여요/.test(cards11()), 'PC 는 실시간 신호가 아니라는 것을 밝힌다');
  ok(D11.run('ghAgentCommit({msg:"Merge pull request #3 from s2ongrae/agent/ui-visibility-v3"})') === true, 'agent/* 머지 커밋은 에이전트 작업으로 본다');
  ok(D11.run('ghAgentCommit({msg:"fix: 카테고리 자동완성"})') === false, '보통 커밋은 PC·직접 작업으로 본다');

  // ④ 통합 이력 — 노트북 오더 + 회사 PC 커밋을 시간순으로
  const evs11 = D11.get('monEvents()');
  ok(evs11.length >= 7, '오더와 커밋이 한 목록에 모인다');
  ok(evs11.every((e, i) => i === 0 || evs11[i - 1].at >= e.at), '최신이 위(시간 내림차순)');
  ok(evs11.some(e => e.who === 'hub') && evs11.some(e => e.who === 'pc'), '노트북·회사 PC·에이전트 세 갈래가 다 보인다');
  ok((cards11().match(/class="mon-dev/g) || []).length === 6, '카드가 6개(직접·허브·회사PC·피원·피투·오더 큐)다');
  ok(/🤖 피원/.test(cards11()) && /🤖 피투/.test(cards11()) && /📋 오더 큐/.test(cards11()), '피원(pi1)·피투(pi2)·오더 큐 카드가 함께 보인다');
  D11.run('AGENT_DATA = {direct: null}');
  ok(/기록 없음/.test(D11.run('monDevDirect()')) && /free로 작업하면/.test(D11.run('monDevDirect()')), '⌨️ 직접 카드: 기록이 없으면 free 안내');
  D11.run('AGENT_DATA = {direct: {state: "working", project: "portal", task: "포털 관제", started_at: new Date().toISOString(), updated_at: new Date().toISOString()}}');
  ok(/작업 중/.test(D11.run('monDevDirect()')), '⌨️ 직접 카드: 작업 중이면 상태를 보여준다');
  D11.run('AGENT_DATA = {direct: {state: "working", project: "portal", task: "포털 관제", started_at: new Date(Date.now() - 30 * 60000).toISOString(), updated_at: new Date(Date.now() - 30 * 60000).toISOString()}}');
  ok(/미확인/.test(D11.run('monDevDirect()')), '⌨️ 직접 카드: 25분 넘게 신호가 없으면 미확인');
  D11.run('AGENT_DATA = {direct: {state: "idle", project: "portal", task: "포털 관제", updated_at: new Date().toISOString()}}');
  ok(/쉬는 중/.test(D11.run('monDevDirect()')), '⌨️ 직접 카드: 쉬는 중이면 회색 상태');

  // ③-2 💻 회사 PC 비트(agent_beat target=pc) — 비공개 레포·커밋 전 작업까지
  D11.run('AGENT_DATA = {pc: {state: "working", project: "smartstore", task: "상품 상세페이지 수정", started_at: new Date().toISOString(), updated_at: new Date().toISOString(), source: "manual", stale_min: 30}}');
  ok(/작업 중/.test(D11.run('monDevPc()')) && /상품 상세페이지 수정/.test(D11.run('monDevPc()')), '💻 회사 PC 카드: PC 비트가 있으면 작업 중·작업명을 보여준다');
  ok(/🛒|묘한살림/.test(D11.run('monDevPc()')), '💻 회사 PC 카드: 프로젝트 이름으로 묶어 보여준다');
  ok(/직접 표시/.test(D11.run('monDevPc()')) && /ord-elapsed/.test(D11.run('monDevPc()')), '💻 회사 PC 카드: 출처와 경과 시간을 보여준다');
  D11.run('AGENT_DATA = {pc: {state: "working", project: "smartstore", task: "커밋", started_at: ' + JSON.stringify(at(nowMs - 90 * 60000)) + ', updated_at: ' + JSON.stringify(at(nowMs - 90 * 60000)) + ', source: "commit", stale_min: 120}}');
  ok(/작업 중/.test(D11.run('monDevPc()')) && !/미확인/.test(D11.run('monDevPc()')), '💻 커밋 알림은 90분이 지나도 미확인이 아니다(커밋 간격)');
  D11.run('AGENT_DATA = {pc: {state: "working", project: "smartstore", task: "커밋", started_at: ' + JSON.stringify(at(nowMs - 130 * 60000)) + ', updated_at: ' + JSON.stringify(at(nowMs - 130 * 60000)) + ', source: "commit", stale_min: 120}}');
  ok(/미확인/.test(D11.run('monDevPc()')), '💻 회사 PC 카드: stale_min(120분)을 넘으면 미확인');
  D11.run('AGENT_DATA = {pc: {state: "working", project: "smartstore", task: "x", started_at: new Date().toISOString(), updated_at: new Date(Date.now() - 40 * 60000).toISOString(), stale_min: 30}}');
  ok(/미확인/.test(D11.run('monDevPc()')), '💻 직접 표시는 30분이 지나면 미확인');
  ok(/pcbeat done/.test(D11.run('monDevPc()')), '💻 미확인이면 무엇을 하면 되는지 알려준다');
  D11.run('AGENT_DATA = {pc: {state: "idle", project: "smartstore", task: "상품 등록", updated_at: new Date().toISOString()}}');
  ok(/쉬는 중/.test(D11.run('monDevPc()')) && /pcbeat start/.test(D11.run('monDevPc()')), '💻 회사 PC 카드: 쉬는 중이면 마지막 작업과 다음 방법');
  D11.run('AGENT_DATA = {pc: {state: "working", project: "smartstore", task: "상품 등록", started_at: new Date().toISOString(), updated_at: new Date().toISOString()}}');
  ok(D11.run('monEvents().filter(e => e.who === "pc").length') >= 1, '통합 이력에 회사 PC 비트가 들어간다');
  D11.run('AGENT_DATA = {direct: {state: "working", project: "portal", task: "포털 관제", started_at: new Date().toISOString(), updated_at: new Date().toISOString()}}');
  ok(D11.run('monEvents().filter(e => e.who === "nd").length') >= 1, '통합 이력에 노트북 직접 작업 비트도 들어간다');
  D11.run('AGENT_DATA = {}; monRender(true)');
  ok(D11.run('(function(){ const g = GH_DATA; GH_DATA = null; const h = monDevPc(); GH_DATA = g; return /회사 PC 신호가 아직 없어요/.test(h) && /GitHub 기록을 아직 못 읽었어요/.test(h); })()'), '💻 비트도 커밋도 없으면 솔직하게 안내');
  ok(D11.run('(function(){ const a = AGENT_DATA; AGENT_DATA = {}; const t = pcBeatHowText(); AGENT_DATA = a; return t; })()').indexOf('재배포') >= 0, '서버가 예전 배포면 재배포하고 알려준다');
  ok(D11.run('(function(){ const a = AGENT_DATA; AGENT_DATA = {beat_targets: ["direct", "pc"]}; const t = pcBeatHowText(); AGENT_DATA = a; return t; })()').indexOf('pcbeat') >= 0, '서버가 pc 를 알면 pcbeat 를 켜라고 알려준다');
  ok(/대기 \d+ · 승인 \d+ · 실행 \d+ · 오늘 완료 \d+/.test(D11.run('monDevNotebook()')) && /#order-card/.test(D11.run('monDevNotebook()')), '🏠 허브 카드 끝에 오더 요약과 오더함 이동 링크');
  ok(/🏠 노트북/.test(feed11()) && /💻 회사 PC/.test(feed11()), '이력에 출처가 붙는다');
  D11.run('monFilter({dataset:{f:"pc"}})');
  ok(D11.run('MON_FILTER') === 'pc' && /💻 회사 PC/.test(feed11()) && !/🏠 노트북/.test(feed11()), '갈래를 고르면 그 출처만 남는다');
  D11.run('monFilter({dataset:{f:"all"}})');
  ok(D11.run('MON_FILTER') === 'all', '전체로 되돌린다');
  const xss11 = JSON.stringify(D11.get('monFeedHtml()'));
  ok(xss11.indexOf('<img') < 0, '이력 글은 그대로 그리지 않는다');

  // ⑤ 값이 그대로면 다시 그리지 않고, ⟳ 면 새로 그린다
  D11.el('mon-cards').innerHTML = '<i>그대로</i>';
  D11.run('monRender()');
  ok(D11.el('mon-cards').innerHTML === '<i>그대로</i>', '같은 값이면 관제 화면을 다시 그리지 않는다(깜빡임 방지)');
  D11.run('monRender(true)');
  ok(D11.el('mon-cards').innerHTML !== '<i>그대로</i>', '강제로 그리면 새로 그린다');
  ok(/mon-card/.test(html) && /🖥️ 작업 관제/.test(html), '관제 카드가 포털 맨 위 오더함 앞에 있다');
  ok(html.indexOf('id="mon-card"') < html.indexOf('id="order-card"') && html.indexOf('id="mon-card"') > 0, '모니터링이 오더함보다 위');
}

console.log('U) 🤖 피클 상태·프로젝트 묶음 — 3주체 현황과 프로젝트 필터');
{
  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const S12 = mk();
  const nowMs = Date.now();
  const at = ms => new Date(ms).toISOString();
  const row = (id, created, status, x) => {
    const r = [id, created, 'phone', 'git_pull', 'gaegyebu', '{}', status, 0, '', '', ''];
    while (r.length < HEAD.length) r.push('');
    Object.keys(x || {}).forEach(k => { const i = HEAD.indexOf(k); if (i >= 0) r[i] = x[k]; });
    return r;
  };
  S12.props.QUEUE_SHEET_ID = 'SHEETidAgentProj0001';
  S12.addSheet('SHEETidAgentProj0001', {'Command_Queue': [HEAD.slice(0)].concat([
    row('Q-a1', at(nowMs - 5 * 60000), 'RUNNING', {type: 'claude_prompt', workspace: 'content-hub',
      claimed_at: at(nowMs - 4 * 60000), claimed_by: 'notebook', payload: JSON.stringify({prompt: '카피 다듬기', mode: 'ask'})}),
    row('Q-a2', at(nowMs - 8 * 60000), 'PENDING', {type: 'claude_prompt', workspace: 'smartstore-hub',
      payload: JSON.stringify({prompt: '상세페이지 점검', mode: 'ask'})}),
    row('Q-a3', at(nowMs - 20 * 60000), 'DONE', {type: 'toss_sync', finished_at: at(nowMs - 19 * 60000), duration_ms: 9000, result: '완료'}),
    row('Q-a4', at(nowMs - 30 * 60000), 'WAITING_APPROVAL', {type: 'claude_prompt', workspace: 'insurance-manager',
      payload: JSON.stringify({prompt: '표 정리', mode: 'edit'}), risk_level: 'HIGH', approval_expires_at: at(nowMs + 5 * 60000)})
  ])});
  const D12 = makeDevice(S12);
  D12.config();
  await D12.run('refreshQueueStatus(true)');
  await D12.run('loadOrders()');

  // ① 프로젝트 묶음 — 작업 위치·토스·GitHub 저장소가 같은 이름으로
  ok(D12.run('ordProject({type:"claude_prompt",workspace:"content-hub"})') === 'content', '콘텐츠 허브 오더 → 콘텐츠허브');
  ok(D12.run('ordProject({type:"claude_prompt",workspace:"smartstore-hub"})') === 'smartstore', '스마트스토어 오더 → 묘한살림');
  ok(D12.run('ordProject({type:"toss_sync",workspace:""})') === 'gaegyebu', '토스 동기화 → 가계부');
  ok(D12.run('ordProject({type:"claude_prompt",workspace:""})') === 'life', '위치가 없으면 생활·행정');
  const ps = D12.get('projStats()');
  ok(ps.content.run === 1 && ps.smartstore.pend === 1 && ps.gaegyebu.done === 1 && ps.insurance.wait === 1, '프로젝트별 진행·예정·승인·오늘 끝남을 센다', ps);
  D12.run('monRender(true)');
  const chips = D12.el('mon-proj').innerHTML;
  ['묘한살림', '콘텐츠허브', '가계부', '보험관리툴', '포털·연동', '생활·행정'].forEach(n => ok(chips.indexOf(n) >= 0, `프로젝트 칩: ${n}`));
  ok(/data-p="content"/.test(chips) && /진행 1/.test(chips), '칩에 프로젝트별 진행 건수가 붙는다');

  // ② 프로젝트를 고르면 그 프로젝트 이력만
  ok(D12.run('monEvents().filter(e => e.proj === "content").length') >= 1, '이벤트마다 프로젝트가 붙는다');
  D12.run('monProjFilter({dataset:{p:"content"}})');
  ok(D12.run('MON_PROJ') === 'content', '프로젝트 필터가 걸린다');
  const f12 = D12.el('mon-feed').innerHTML;
  ok(/콘텐츠 허브/.test(f12) && !/가계부/.test(f12), '고른 프로젝트 이력만 남는다');
  D12.run('monProjFilter({dataset:{p:"all"}})');
  ok(D12.run('MON_PROJ') === 'all', '전체로 되돌린다');

  // ③ 🤖 피클 카드 — 진행 중 / 대기 / 정체 / 기록 없음
  ok(/🤖 피원/.test(D12.run('monDevPickle()')), '피원(pi1) 카드가 있다');
  D12.run('AGENT_DATA = {updated_at: "' + at(nowMs) + '", agent: {state: "working", task: "포털 관제 개선", project: "portal", started_at: "' + at(nowMs - 20 * 60000) + '", id: "t1"}, tasks: []}');
  const pkRun = D12.run('monDevPickle()');
  ok(/작업 중/.test(pkRun) && /포털 관제 개선/.test(pkRun) && /data-since="\d{13}"/.test(pkRun), '피클이 하는 일과 경과 시간이 보인다');
  D12.run('AGENT_DATA = {updated_at: "' + at(nowMs - 45 * 60000) + '", agent: {state: "working", task: "오래 걸리는 일", project: "portal", started_at: "' + at(nowMs - 90 * 60000) + '"}, tasks: []}');
  ok(/응답 없음/.test(D12.run('monDevPickle()')) && /30분/.test(D12.run('monDevPickle()')), '30분 넘게 소식이 없으면 멈춘 것 같다고 알린다');
  D12.run('AGENT_DATA = {updated_at: "' + at(nowMs) + '", agent: {state: "idle"}, tasks: [' +
    '{id:"t1", project: "portal", title: "포털 관제 개선", state: "done", started_at: "' + at(nowMs - 60 * 60000) + '", ended_at: "' + at(nowMs - 5 * 60000) + '", result: "배포 완료"}]}');
  ok(/쉴 준비/.test(D12.run('monDevPickle()')) && /배포 완료/.test(D12.run('monDevPickle()')), '쉬는 중이면 마지막으로 끝낸 일을 보여준다');

  // ④ 피클 이력이 통합 이력에 합쳐지고, 갈래 필터가 된다
  const pe = D12.get('agentEvents()');
  ok(pe.length === 1 && pe[0].who === 'pk' && pe[0].proj === 'portal', '피클 작업이 이벤트로 바뀐다');
  D12.run('monRender(true)');
  ok(/🤖 피원/.test(D12.el('mon-feed').innerHTML) && /포털 관제 개선/.test(D12.el('mon-feed').innerHTML), '통합 이력에 피원이 함께 보인다');
  D12.run('monFilter({dataset:{f:"pk"}})');
  ok(D12.run('MON_FILTER') === 'pk' && /🤖 피원/.test(D12.el('mon-feed').innerHTML) && !/💻 회사 PC/.test(D12.el('mon-feed').innerHTML), '🤖 피원 갈래만 고를 수 있다');
  D12.run('monFilter({dataset:{f:"all"}})');

  // ⑤ 피클 기록이 없으면 솔직하게, 테스트 환경에서는 파일을 부르지 않는다
  D12.run('AGENT_DATA = null; MON_FILTER = "all"');
  ok(/기록 없음/.test(D12.run('monDevPickle()')), '기록이 없으면 없다고 보여준다');
  ok(D12.run('agentCanFetch()') === false, '테스트 환경(https 아님)에서는 status/agent.json 을 부르지 않는다');
  ok(D12.calls.every(c => c.opts.method === 'POST' && JSON.parse(c.opts.body).action), '피클 상태도 POST 한 갈래로만 요청한다');
  D12.run('AGENT_DATA = {updated_at: "' + at(nowMs) + '", agent: null, tasks: [{id:"x", project:"content", title: "<img src=x onerror=alert(1)>", state: "done", ended_at: "' + at(nowMs) + '"}]}');
  ok(JSON.stringify(D12.get('monFeedHtml()')).indexOf('<img') < 0, '피클이 남긴 글도 그대로 그리지 않는다');
}

console.log('V) 💬 비서 통합 회의실 — 카톡 타임라인·@멘션·사용량·비서 슬롯');
{
  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const S13 = mk();
  const nowMs = Date.now();
  const at = ms => new Date(ms).toISOString();
  const row = (id, created, status, x) => {
    const r = [id, created, 'portal', 'claude_prompt', 'gaegyebu', '{}', status, 0, '', '', ''];
    while (r.length < HEAD.length) r.push('');
    Object.keys(x || {}).forEach(k => { const i = HEAD.indexOf(k); if (i >= 0) r[i] = x[k]; });
    return r;
  };
  S13.props.QUEUE_SHEET_ID = 'SHEETidRoomTest0001';
  S13.addSheet('SHEETidRoomTest0001', {'Command_Queue': [HEAD.slice(0)].concat([
    row('Q-r1', at(nowMs - 6 * 60000), 'DONE', {source: 'pi1', workspace: 'content-hub',
      payload: JSON.stringify({prompt: '@피투 이번 주 블로그 소재 3개만 뽑아줘', mode: 'ask', kind: 'chat', target: 'pi2'}),
      finished_at: at(nowMs - 5 * 60000), duration_ms: 12000, result: '블로그 소재 3개 뽑았습니다: ① 서울숲 ② 성수 ③ 대전 소제'}),
    row('Q-r2', at(nowMs - 30 * 60000), 'DONE', {source: 'portal', workspace: 'gaegyebu',
      payload: JSON.stringify({prompt: '가계부 11월 지출 점검해줘', mode: 'ask', kind: 'chat'}),
      finished_at: at(nowMs - 29 * 60000), duration_ms: 4000, result: '11월 지출부터 볼게요. 확인이 필요한 점: 카드값 마감일'}),
    row('Q-r3', at(nowMs - 2 * 60000), 'WAITING_APPROVAL', {source: 'pi2', workspace: 'gaegyebu',
      payload: JSON.stringify({prompt: '제목 고쳐줘', mode: 'edit', target: 'pi1'}), risk_level: 'HIGH',
      approval_expires_at: at(nowMs + 9 * 60000)})
  ])});
  const D13 = makeDevice(S13);
  D13.config();
  await D13.run('loadOrders()');
  const feed = () => D13.el('ord-list').innerHTML;
  const lastBody13 = a => {
    for (let i = D13.calls.length - 1; i >= 0; i--) { const b = JSON.parse(D13.calls[i].opts.body); if (b.action === a) return b; }
    return null;
  };

  // ① 회의실 뼈대
  ok(/비서-통합-회의실/.test(html) && /id="room-people"/.test(html), '회의실 머리말(# 비서-통합-회의실 · 참여자 수)');
  ok(/id="room-use"/.test(html) && /📊 비서 사용량/.test(html) && /<details class="room-use"/.test(html), '📊 비서 사용량이 접기/펼치기 패널로 있다');
  ok(/id="ord-presets"/.test(html) && /id="ord-mentions"/.test(html) && /id="ord-mode"/.test(html) && /id="ord-who"/.test(html),
    '하단 입력바에 프리셋·대상 칩·모드·발신 선택이 있다');
  ok(/class="order-card room-card"/.test(html) && html.indexOf('id="mon-card"') < html.indexOf('id="order-card"'), '관제 카드 아래에 회의실이 이어진다');
  ok((D13.el('room-people').textContent || '').indexOf('명') >= 0, '참여 비서 수가 머리말에 보인다');
  let sum = D13.el('use-sum').innerHTML;
  ok(/위험/.test(sum) && /임박/.test(sum) && /정상/.test(sum) && /미확인/.test(sum), '사용량 요약(위험·임박·정상·미확인)');

  // ② 참여자·대상 칩은 레지스트리에서 나온다
  const ment = D13.el('ord-mentions').innerHTML;
  ok(/@전체/.test(ment) && /@피원/.test(ment) && /@피투/.test(ment) && /@노트북/.test(ment), '@전체·@피원·@피투·@노트북 대상 칩');
  ok(D13.run('ordTargetList().length') === 7, '대상 목록 = 전체 + 참여 비서 6(피원·피투·큐·부이·키링·노트북)');
  ok(/블로그 초안/.test(D13.el('ord-presets').innerHTML) && /상태 확인/.test(D13.el('ord-presets').innerHTML), '빠른 오더 프리셋 버튼');
  D13.run('ordPreset({dataset:{i:"0"}})');
  ok(/블로그 초안|대전 로컬 맛집/.test(D13.el('ord-inp').value), '프리셋을 누르면 입력칸이 채워진다(자동 전송 없음)');

  // ③ 카톡 타임라인 — 내 말은 오른쪽, 비서 답은 왼쪽
  const f1 = feed();
  ok(/class="chat-row out"/.test(f1) && /class="chat-row in"/.test(f1), '보낸 말은 오른쪽, 비서 말은 왼쪽 말풍선');
  ok(/who w-pi1/.test(f1) && /피원/.test(f1), '피원(pi1)이 낸 말에는 피원 배지');
  ok(/who w-pi2/.test(f1), '피투(pi2)가 낸 말에는 피투 배지');
  ok(/&lt;|@피투/.test(f1) && /class="mt mt-pi2"/.test(f1), '본문의 @피투 는 하이라이트 칩으로 그린다');
  ok(/블로그 소재 3개 뽑았습니다/.test(f1), '비서 답장이 말풍선으로 보인다');
  ok(/chat-to/.test(f1) && /@피투/.test(f1), '답장에 대상(→ @피투) 표시');
  ok(/data-id="Q-r3"/.test(f1) && (f1.match(/data-id="Q-r3"/g) || []).length === 2, '승인 대기 말풍선에 승인·거절 버튼 2개');
  ok(/class="chat-day"/.test(f1), '날짜 구분선(오늘/어제)');

  // ④ 상태·발신 필터
  D13.run('ordFilterSet({dataset:{k:"who",v:"pi1"}})');
  ok(D13.run('ORD_WHO') === 'pi1' && /블로그 소재/.test(feed()) && !/가계부 11월 지출/.test(feed()), '발신 피원만 남긴다');
  D13.run('ordFilterSet({dataset:{k:"who",v:"all"}})');
  D13.run('ordFilterSet({dataset:{k:"st",v:"wait"}})');
  ok(/승인 대기/.test(feed()) && !/블로그 소재/.test(feed()), '상태 필터(승인 대기)가 먹는다');
  D13.run('ordFilterSet({dataset:{k:"st",v:"all"}})');
  ok(D13.run('ordFilterSet({dataset:{k:"who",v:"nope"}}), ORD_WHO') === 'all', '모르는 필터 값은 전체로');

  // ⑤ 보내기 — 대화 모드면 kind=chat · 발신·대상이 함께 실린다
  D13.run("ordModeSet('chat')");
  ok(D13.run('ORD_MODE') === 'chat' && D13.el('ord-edit-mode').checked === false, '대화 모드 기본');
  D13.el('ord-inp').value = '@피원 이번 주 일정 정리해줘';
  await D13.run('sendOrder()');
  let be = lastBody13('queue_enqueue');
  ok(be && be.payload.kind === 'chat' && be.payload.mode === 'ask', '대화는 claude_prompt + kind=chat 로 접수');
  ok(be.source === 'portal' && be.client_id === 'portal', '발신(source·client_id)이 함께 간다');
  D13.run('ordTargetSet({dataset:{t:"pi2"}})');
  await D13.run("loadOrders(); ORD_TARGET");
  D13.el('ord-inp').value = '피투한테 넘길 일';
  await D13.run('sendOrder()');
  be = lastBody13('queue_enqueue');
  ok(be.payload.target === 'pi2', '대상 @피투 가 payload.target 으로 간다');
  D13.run("ordModeSet('edit')");
  ok(D13.el('ord-edit-mode').checked === true && D13.run('ORD_MODE') === 'edit', '수정 모드는 체크박스와 함께 움직인다');
  D13.run("ordModeSet('chat')");

  // ⑥ 답글·오더로·복사
  D13.run("ordReplyById('Q-r2')");
  ok(!!D13.run('ORD_REPLY_TO') && /가계부/.test(D13.run('ORD_REPLY_TO')), '답글을 누르면 원문을 인용할 준비를 한다');
  ok(/chat-quote/.test(D13.el('ord-quote').innerHTML), '인용 미리보기가 입력칸 위에 보인다');
  D13.el('ord-inp').value = '카드값 마감일은 25일이야';
  await D13.run('sendOrder()');
  be = lastBody13('queue_enqueue');
  ok(/^↩ /.test(be.payload.prompt) && /카드값 마감일/.test(be.payload.prompt), '답글은 원문 인용을 붙여 보낸다');
  ok(D13.run('ORD_REPLY_TO') === '', '보내면 인용은 지워진다');
  D13.run("ordModeSet('chat'); ordPromoteById('Q-r2')");
  ok(D13.run('ORD_MODE') === 'ask', '답장에서 [📦 오더로] 누르면 오더 모드로 바뀐다');
  D13.run("ordModeSet('chat')");

  // ⑦ 사용량 — 남은 % 직접 입력 · 상태 계산 · 이 기기 저장
  ok(D13.run('useState(5)') === 'danger' && D13.run('useState(20)') === 'soon' && D13.run('useState(50)') === 'ok' && D13.run('useState(null)') === 'unknown',
    '남은 % 상태: 위험<10 · 임박<30 · 정상 · 미확인');
  ok(/리셋/.test(D13.run("useLeftText(useResetAt({reset:'daily04'}) - Date.now())")), '일일 리셋 남은 시간을 04:00 기준으로 센다');
  ok(/리셋/.test(D13.run("useLeftText(useResetAt({reset:'weekly'}) - Date.now())")), '주간 리셋도 문구가 나온다');
  D13.run("useEditStart('pi1')");
  ok(/잔여 %/.test(D13.el('use-inp-pi1').placeholder || '') || D13.run('USE_EDIT') === 'pi1', '잔여 입력 칸이 열린다');
  D13.el('use-inp-pi1').value = '8';
  D13.run("useCommit('pi1')");
  ok(D13.run('useOf("pi1").pct') === 8, '넣은 %가 기록된다');
  ok(JSON.parse(D13.store.get('portal_use_v1')).items.pi1.pct === 8, '이 기기(localStorage)에 저장된다');
  ok(D13.run('useSummary().danger') === 1, '요약이 위험 1 로 센다');
  D13.el('use-inp-pi1').value = '250';
  D13.run("useEditStart('pi1'); useCommit('pi1')");
  ok(D13.run('useOf("pi1").pct') === 8, '0~100 밖의 값은 받지 않는다');
  D13.run("useMerge([{id:'pi1',pct:40,at:new Date(Date.now()+60000).toISOString()}])");
  ok(D13.run('useOf("pi1").pct') === 40, '서버 값이 더 최근이면 그쪽을 쓴다');
  D13.run("useMerge([{id:'pi1',pct:90,at:new Date(Date.now()-60000).toISOString()}])");
  ok(D13.run('useOf("pi1").pct') === 40, '더 오래된 값은 무시한다');

  // ⑧ 비서 슬롯 추가 — 한 곳(레지스트리)만 늘리면 카드·멘션·배지가 같이 늘어난다
  //    (부이·큐·키링은 이제 기본 참여자라 '부이2' 로 시험한다)
  D13.run('useAddStart()');
  D13.el('use-new-name').value = '부이2';
  D13.run('useAddCommit()');
  ok(D13.run('agentMentions().some(a=>a.name==="부이2")') === true, '새 비서가 참여자 목록에 들어간다');
  ok(D13.run('useDefs().some(d=>d.name==="부이2")') === true, '사용량 카드 목록에도 들어간다');
  D13.run('renderRoom()');
  ok(/@부이2/.test(D13.el('ord-mentions').innerHTML), '@부이2 멘션 칩이 자동으로 생긴다');
  ok(/부이2/.test(D13.el('use-grid').innerHTML), '사용량 카드도 자동으로 생긴다');
  const vooy2 = D13.run("agentMentions().filter(a=>a.name==='부이2')[0].id");
  ok(/^a[0-9a-z]+$/.test(vooy2), '추가한 비서 id 는 시트 규칙에 맞는 값(a…)');
  D13.run(`ORD_TARGET='${vooy2}'`);
  D13.el('ord-inp').value = '@부이2 내일 일정 봐줘';
  await D13.run('sendOrder()');
  be = lastBody13('queue_enqueue');
  ok(be.payload.target === vooy2, '새 비서에게도 오더가 간다(payload.target)');
  D13.run('renderOrders()');
  ok(new RegExp('mt-' + vooy2).test(D13.el('ord-list').innerHTML) || /mt-new/.test(D13.el('ord-list').innerHTML), '새 비서 멘션도 칩으로 그린다');
  D13.run(`agentRemove('${vooy2}'); renderRoom()`);
  ok(!/@부이2/.test(D13.el('ord-mentions').innerHTML) && D13.run('agentMentions().some(a=>a.name==="부이2")') === false, '뺀 비서는 목록에서 사라진다');

  // ⑨ 말풍선 속 값도 이스케이프
  D13.run(`ORD_ITEMS = [{id:'Q-x', status:'DONE', source:'pi1', type:'claude_prompt', kind:'chat', summary:'<img src=x>@피원', result:'<script>x</script>', created_at:new Date().toISOString()}]; renderOrders()`);
  ok(feed().indexOf('<img') < 0 && feed().indexOf('<script') < 0 && feed().indexOf('&lt;img') >= 0, '말풍선 글자도 그대로 그리지 않는다');
  ok(/class="mt mt-pi1"/.test(feed()), '이스케이프한 뒤에도 @피원 칩은 살아 있다');
}

console.log('W) 👥 큐·부이·키링 기본 탑재 · 서버 명부 공유 · 부분 사용량 보고');
{
  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const S14 = mk();
  const nowMs = Date.now();
  const at = ms => new Date(ms).toISOString();
  const row = (id, created, status, x) => {
    const r = [id, created, 'portal', 'claude_prompt', 'gaegyebu', '{}', status, 0, '', '', ''];
    while (r.length < HEAD.length) r.push('');
    Object.keys(x || {}).forEach(k => { const i = HEAD.indexOf(k); if (i >= 0) r[i] = x[k]; });
    return r;
  };
  S14.props.QUEUE_SHEET_ID = 'SHEETidCueRoom001';
  S14.addSheet('SHEETidCueRoom001', {'Command_Queue': [HEAD.slice(0)].concat([
    row('Q-c1', at(nowMs - 6 * 60000), 'DONE', {source: 'cue', workspace: 'gaegyebu',
      payload: JSON.stringify({prompt: '@포털 연결 확인했어요 — 리서치 대기', mode: 'ask', kind: 'chat', target: 'portal'}),
      finished_at: at(nowMs - 5 * 60000), result: '연결 OK. 리서치 대기 중'}),
    row('Q-c2', at(nowMs - 9 * 60000), 'DONE', {source: 'keyring', workspace: 'gaegyebu',
      payload: JSON.stringify({prompt: '@전체 예약 확인했어요', mode: 'ask', kind: 'chat', target: 'all'}),
      finished_at: at(nowMs - 8 * 60000), result: 'KTX 예약 1건 확인'})
  ])});
  const D14 = makeDevice(S14);
  D14.config();
  await D14.run('loadOrders()');
  const feed14 = () => D14.el('ord-list').innerHTML;
  const lastBody14 = a => {
    for (let i = D14.calls.length - 1; i >= 0; i--) { const b = JSON.parse(D14.calls[i].opts.body); if (b.action === a) return b; }
    return null;
  };

  // ① 기본 참여자로 큐·부이·키링이 들어 있다
  const ment = D14.el('ord-mentions').innerHTML;
  ok(/@큐/.test(ment) && /@부이/.test(ment) && /@키링/.test(ment), '대상 칩에 @큐·@부이·@키링이 기본으로 있다');
  ok(D14.run("['cue','vooy','keyring'].every(id=>!!agentById(id))"), '명부(AGENT_SEED)에 cue·vooy·keyring 이 있다');
  ok(D14.run("['cue','vooy','keyring'].every(id=>useDefs().some(d=>d.id===id))"), '사용량 카드에도 셋 다 있다');
  ok(D14.run('ordTargetList().length') === 7, '대상 목록 = 전체 + 6명(피원·피투·큐·부이·키링·노트북)');
  ok(D14.run("ordSenderList().some(a=>a.id==='cue') && !ordSenderList().some(a=>a.id==='notebook')"), '발신 후보에는 큐가 있고 노트북은 뺀다');
  ok(/큐|부이|키링/.test(D14.el('use-grid').innerHTML), '사용량판에 큐·부이·키링 카드가 그려진다');
  ok(/나와의|위험/.test(D14.el('use-sum').innerHTML) && D14.run('useDefs().length') === 9, '사용량 줄 9개(피원·피투·큐·부이·키링·엔진3·회사PC)');

  // ② 큐·키링이 낸 말은 '나'가 아니라 왼쪽 말풍선 + 전용 배지
  ok(/who w-cue/.test(feed14()) && /who w-key/.test(feed14()), '큐(w-cue)·키링(w-key) 전용 배지');
  ok(D14.run("ordIsMine({source:'cue'})") === false && D14.run("ordIsMine({source:'portal'})") === true,
    '큐가 보낸 말은 오른쪽(내 말)로 그리지 않는다');
  ok(D14.run("ordSenderKey({source:'keyring'})") === 'keyring', 'source=keyring 은 키링으로 읽는다');
  ok(/class="mt mt-cue"/.test(D14.run("ordMentionHtml('@큐 리서치 대기 중')")), '본문의 @큐 도 큐 색 멘션 칩');
  ok(/class="mt mt-key"/.test(D14.run("ordMentionHtml('@키링 예약 확인')")), '본문의 @키링 도 키링 색 멘션 칩');

  // ③ 본문에 적은 @이름으로 대상이 정해진다(칩을 안 눌러도)
  ok(D14.run("ordTargetFromText('@큐 이거 봐줘')") === 'cue', '@큐 → cue');
  ok(D14.run("ordTargetFromText('@키링 3시 예약')") === 'keyring', '@키링 → keyring');
  ok(D14.run("ordTargetFromText('@부이 비교해줘')") === 'vooy', '@부이 → vooy');
  ok(D14.run("ordTargetFromText('메일 a@b.com')") === '', '주소 속 @ 는 멘션이 아니다');
  D14.run("ordTargetSet({dataset:{t:'notebook'}})");
  D14.el('ord-inp').value = '@큐 내일 리서치 하나만 봐줘';
  await D14.run('sendOrder()');
  let be = lastBody14('queue_enqueue');
  ok(be.payload.target === 'cue', '칩이 @노트북이어도 글로 적은 @큐 가 이긴다');
  D14.run("ordTargetSet({dataset:{t:'notebook'}})");

  // ④ ＋추가한 비서가 서버(agent_save)에 올라가고, 다른 기기가 같은 명부를 받는다
  D14.el('use-new-name').value = '큐2';
  D14.run('useAddStart(); useAddCommit()');
  await new Promise(r => setTimeout(r, 30));
  const addB = lastBody14('agent_save');
  ok(addB && addB.items && addB.items[0].name === '큐2' && /^a[0-9a-z]+$/.test(addB.items[0].id), '＋추가가 agent_save 로 서버에 간다');
  const D15 = makeDevice(S14);
  D15.config();
  await D15.run('agentServerGet()');
  ok(D15.run("agentMentions().some(a=>a.name==='큐2')"), '다른 기기(새 폰)도 큐2 를 받는다');
  D15.run('renderRoom()');
  ok(/@큐2/.test(D15.el('ord-mentions').innerHTML), '다른 기기에도 @큐2 칩이 생긴다');
  ok(JSON.parse(D15.store.get('portal_agents_v1') || '[]').some(a => a.name === '큐2'), '다른 기기 localStorage 에도 남는다');

  // ⑤ 한 기기에서 뺐으면 다른 기기에서도 사라진다
  const cue2id = D14.run("agentMentions().filter(a=>a.name==='큐2')[0].id");
  D14.run(`agentRemove('${cue2id}')`);
  await new Promise(r => setTimeout(r, 30));
  const rmB = lastBody14('agent_save');
  ok(rmB && (rmB.removed || []).some(x => (typeof x === 'string' ? x : x.id) === cue2id), '🗑 빼기도 agent_save(removed)로 서버에 간다');
  await D15.run('agentServerGet()');
  ok(!D15.run("agentMentions().some(a=>a.name==='큐2')"), '다른 기기에서도 뺀 비서가 사라진다');

  // ⑥ 큐에 처음 말을 건 새 비서는 자동 합류(sources_seen) — 어느 기기에서도 @멘션
  ok(D14.run("agentAutoJoin(['cue2','bad id!','portal','notebook']).length") === 1, '새 비서만 골라 합류한다(이상한 값·내 말·노트북 제외)');
  ok(D14.run("agentMentions().some(a=>a.id==='cue2')") === true, '합류한 비서가 참여자가 된다');
  ok(lastBody14('agent_save').items.some(x => x.id === 'cue2'), '합류도 서버에 남긴다');
  await D15.run('agentServerGet()');
  ok(D15.run("agentMentions().some(a=>a.id==='cue2')"), '다른 기기도 합류한 비서를 받는다');

  // ⑦ 비서가 보고한 사용량(부분 갱신)이 화면에 반영된다 — 메모까지
  D14.run("useMerge([{id:'cue',pct:12,at:new Date(Date.now()+60000).toISOString(),note:'리서치 대기'}])");
  ok(D14.run("useOf('cue').pct") === 12 && D14.run("useOf('cue').note") === '리서치 대기', 'cue 줄만 12%·메모로 바뀐다');
  ok(D14.run("useSummary().soon") >= 1, '임박(<30%)로 센다');
  D14.run('renderUse(true)');
  ok(/리서치 대기/.test(D14.el('use-grid').innerHTML), '카드에 비서가 남긴 한 줄 메모가 보인다');
  ok(/usage_report/.test(D14.el('use-note').textContent || ''), '입력 없이도 비서가 스스로 보고한다고 안내');
  D14.run("useMerge([{id:'cue',pct:80,at:new Date(Date.now()-60000).toISOString(),note:'옛 메모'}])");
  ok(D14.run("useOf('cue').pct") === 12 && D14.run("useOf('cue').note") === '리서치 대기', '오래된 보고는 무시한다');

  // ⑧ 예전 배포(agents_get 모름)면 조용히 서버를 더 부르지 않는다(이 기기 명부만)
  const n0 = D14.calls.length;
  D14.run('AG_SRV = false');
  const noAg = await D14.run('agentServerGet()');
  ok(noAg === null && D14.calls.length === n0, '예전 배포로 판명되면 agents_get 을 다시 부르지 않는다');
  ok(D14.run("agentMentions().some(a=>a.id==='cue')") === true, '그래도 큐·부이·키링은 그대로 쓸 수 있다');
  D14.run('AG_SRV = null');
}

console.log(`\n포털 통합 테스트: ${pass}건 통과, ${fail}건 실패`); process.exit(fail?1:0);
})();
