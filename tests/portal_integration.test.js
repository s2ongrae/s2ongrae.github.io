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
  ok((bar.match(/class="stat ok"/g)||[]).length===2 && (bar.match(/class="stat warn"/g)||[]).length===1, '배지 색: 노트북 초록 · 명령 노랑 · 토스 초록');
  ok(bar.includes('2분 전'), '노트북: 2분 전');
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
  ok(D6.el('sync-txt').textContent.indexOf('접수됨') >= 0, '접수 안내가 뜬다');

  // ⑦ 파일 수정 허용 → 승인 대기로 접수
  D6.el('ord-edit-mode').checked = true;
  D6.el('ord-inp').value = '메리 쇼츠 제목 후보 3개 뽑아줘';
  await D6.run('sendOrder()');
  be = lastBody('queue_enqueue');
  ok(be && be.payload.mode === 'edit', '파일 수정 허용이면 mode=edit 로 보낸다');
  ok(D6.get('ORD_ITEMS').some(i => i.status === 'WAITING_APPROVAL' && i.summary.indexOf('메리 쇼츠 제목') >= 0), '파일 수정 오더는 승인 대기에 쌓인다');
  ok(D6.el('ord-edit-mode').checked === false, '접수 뒤 체크를 풀어 둔다');

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
  ok(!/<script|<img|<i>|<b>/.test(box()) && box().indexOf('&lt;') >= 0, '알 수 없는 상태·값도 이스케이프해서 그린다');
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
  ok(/저장소 · 최신화/.test(html) && /가계부 · 돈/.test(html) && /조회 · 분석/.test(html) && /파일 수정 \(승인 필요\)/.test(html), '기능 4갈래를 한눈에 보여준다');
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

console.log(`\n포털 통합 테스트: ${pass}건 통과, ${fail}건 실패`); process.exit(fail?1:0);
})();
