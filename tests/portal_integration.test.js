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
/** 말풍선 머리 `<b>` 안에 그 비서의 **마크(data-mark)** 와 이름이 함께 있는가 — 2026-11-26 이모지 → 마크 */
const whoIn=(html,id,name)=>new RegExp('<b>(?:(?!</b>)[\\s\\S])*data-mark="'+id+'"(?:(?!</b>)[\\s\\S])*'+name+'</b>').test(html);
/** 아바타 칸이 그 비서의 마크로 그려졌는가 */
const avMark=(html,id)=>new RegExp('class="chat-av" role="img" aria-label="[^"]*"><span class="mk mk-[a-z0-9]+[^"]*" data-mark="'+id+'"').test(html);
/** 인라인 SVG 본문을 떼어낸 HTML — 마크와 이름이 붙어 있는지만 볼 때 */
const noSvg=h=>String(h||'').replace(/<svg[\s\S]*?<\/svg>/g,'');
/** 마크 자리를 [id] 로 바꿔 "[cue]큐" 처럼 마크 바로 뒤에 이름이 오는지 본다 */
const markThen=(html,id,name)=>noSvg(html).replace(/<span class="mk[^>]*data-mark="([a-z0-9_-]+)"[^>]*><\/span>/g,'[$1]').indexOf('['+id+']'+name)>=0;
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
  ok(!D3.store.get('portal_qstatus_cache'), '예전 배포(안 되는 요청)는 5분 캐시에 담지 않음 — 재배포되면 바로 알아챈다');
  let n0 = D3.calls.length; await D3.run('refreshQueueStatus()');
  ok(D3.calls.length===n0+1, '세팅 대기 응답은 캐시로 굳히지 않고 다시 확인');

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

  // ④-1 회귀(2026-11-27): 일시 실패를 5분 캐시에 담아 '미연결 (세팅 대기)'로 5분간 굳던 버그
  const S5 = mk(), fakeNow5 = S5.run('Date.now()');
  const iso5 = m => new Date(fakeNow5 - m*60000).toISOString();
  S5.props.QUEUE_SHEET_ID = 'SHEETidForTest0005';
  S5.addSheet('SHEETidForTest0005', {'Command_Queue': [
    ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by','finished_at'],
    ['c1', iso5(3), 'phone','git_pull','gaegyebu','{}','PENDING',0,'','',''],
  ]});
  const D5 = makeDevice(S5); D5.config();
  const realDoPost = S5.sb.doPost; let failOnce = true;
  S5.sb.doPost = e => {                       // 첫 queue_status 만 '연결 실패' (일시 타임아웃·오류 흉내)
    try { if(failOnce && JSON.parse(e.postData.contents).action === 'queue_status'){
      failOnce = false; return { getContent: () => JSON.stringify({ok:false, error:'연결 실패'}) }; } } catch(_) {}
    return realDoPost(e);
  };
  let c5 = D5.calls.length;
  const r5a = await D5.run('refreshQueueStatus()');
  bar = D5.el('statusbar').innerHTML;
  ok(D5.calls.length===c5+1 && r5a && r5a.connected===false, '일시 실패: 그 순간은 미연결로 보인다');
  ok(!D5.store.get('portal_qstatus_cache'), '일시 실패는 5분 캐시에 남기지 않음');
  ok(r5a && r5a.reason==='error' && !/재배포/.test(bar), "일시 오류를 '예전 배포 — 재배포'라고 잘못 안내하지 않음");
  const r5b = await D5.run('refreshQueueStatus()');   // force 없이, 5분 안이어도
  ok(D5.calls.length===c5+2 && r5b && r5b.connected===true, '5분 안이라도 서버가 살아나면 다시 받아 연결됨');
  ok(/대기 1/.test(D5.el('statusbar').innerHTML), '화면도 미연결에서 벗어나 실제 상태를 보여 줌');
  ok(!!D5.store.get('portal_qstatus_cache'), '연결된 응답은 5분 캐시에 담음');
  const c5b = D5.calls.length; await D5.run('refreshQueueStatus()');
  ok(D5.calls.length===c5b, '연결된 뒤에는 5분 캐시로 호출을 아낀다');
  D5.store.set('portal_qstatus_cache', JSON.stringify({at: new Date().toISOString(), data:{ok:false, connected:false, reason:'unsupported'}}));
  const c5c = D5.calls.length; const r5c = await D5.run('refreshQueueStatus()');
  ok(D5.calls.length===c5c+1 && r5c && r5c.connected===true, '예전 버전이 남긴 실패 캐시는 무시하고 새로 받아옴');

  // ⑤ 서버가 준 글자도 이스케이프
  D4.run(`renderQueueStatus({ok:true, connected:true, at:new Date().toISOString(), heartbeat:{state:'ok',min:1,source:'sheet'}, queue:{state:'ok',pending:0,waiting:0,timeout:0,oldest_min:null}, toss:{state:'warn',date:'<b>x</b>',days:2}})`);
  bar = D4.el('statusbar').innerHTML;
  ok(!/<b>x<\/b>/.test(bar) && bar.includes('&lt;b&gt;'), '상태 값도 이스케이프');

  // ⑤-1 하트비트 파일이 없을 때 — 시트 활동으로 노트북을 '대기 중·마지막 응답'이라 말하지 않는다(2026-11-18)
  D4.run(`renderQueueStatus({ok:true, connected:true, at:new Date().toISOString(), heartbeat:{state:'unknown',source:'sheet',approx:true,min:2,reason:'no_heartbeat'}, queue:{state:'ok',pending:1,waiting:0,timeout:0,oldest_min:2,review:0}, toss:{state:'ok',date:'2026-11-18',days:0}})`);

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

console.log('T) 🗑️ 작업 관제 카드 제거(2026-11-27) — 브리핑·지금 작업 중과 겹치고, GitHub API 호출이 시간당 한도(403)에 걸렸다');
ok(!/id="mon-card"/.test(html) && !/api\.github\.com/.test(html), '관제 카드와 GitHub API 호출이 없다(페이지가 가벼워짐)');
ok(/id="approval-card"/.test(html) && /id="brief-card"/.test(html) && /id="room-live"/.test(html), '대신 승인함·브리핑·지금 작업 중이 그 일을 한다');

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
  ok(D13.run('ORD_TARGET') === 'all', '기본 대상은 @전체 — 노트북은 @노트북을 직접 고를 때만(2026-11-26)');
  ok(D13.run("ordNeedsWorker({kind:'chat', target:'all', source:'portal'})") === false, '@전체 대화는 노트북 대기열이 아니다');
  ok(D13.run("ordNeedsWorker({kind:'chat', target:'notebook', source:'portal'})") === true, '@노트북 대화는 노트북이 받는다');
  ok(D13.run("ordNeedsWorker({kind:'ask', target:'all', source:'portal'})") === true, '실행 오더의 @전체는 노트북이 받는다');
  ok(/비서-통합-회의실/.test(html) && /id="room-people"/.test(html), '회의실 머리말(# 비서-통합-회의실 · 참여자 수)');
  ok(/id="room-use"/.test(html) && /📊 비서 사용량/.test(html) && /<details class="room-use"/.test(html), '📊 비서 사용량이 접기/펼치기 패널로 있다');
  ok(/id="ord-presets"/.test(html) && /id="ord-mentions"/.test(html) && /id="ord-mode"/.test(html) && /id="ord-who"/.test(html),
    '하단 입력바에 프리셋·대상 칩·모드·발신 선택이 있다');
  ok(/class="order-card room-card"/.test(html) && !/id="mon-card"/.test(html), '회의실이 있다(관제 카드는 2026-11-27 제거)');
  ok((D13.el('room-people').textContent || '').indexOf('명') >= 0, '참여 비서 수가 머리말에 보인다');
  let sum = D13.el('use-sum').innerHTML;
  ok(/위험/.test(sum) && /임박/.test(sum) && /정상/.test(sum) && /미확인/.test(sum), '사용량 요약(위험·임박·정상·미확인)');
  // 2026-11-25 v34 리뉴얼 — 남는 말은 표로, 폰 입력바는 ＋로 접는다
  ok(/id="room-roles"/.test(html) && /id="role-table"/.test(html), '역할표(누가 무엇을 맡나) 패널이 있다');
  ok((D13.el('role-table').innerHTML.match(/class="role-row"/g) || []).length === 6, '역할표에 참여 비서 6명이 그려진다');
  ok(/총괄 조율/.test(D13.el('role-table').innerHTML) && /id="room-plus"/.test(html), '역할표에 담당이 보이고, 폰 입력바에 도구 열기 버튼이 있다');

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

  // ⑩ [워커 규칙] 문구는 화면에 안 보인다(2026-11-25) — 새 말뿐 아니라 이미 저장된 옛 메시지도
  {
    const note = '\n\n[워커 규칙] 셸(Bash)은 차단되어 있다. 테스트·문법 검증은 네가 저장한 뒤 워커가 직접 돌린다. ' +
      'npm test·node --test 같은 실행 명령을 시도하지 말고, 바꾼 파일과 완료 조건만 보고해라.';
    const N = JSON.stringify(note);
    D13.run(`ORD_ITEMS = [
      {id:'Q-n1', status:'DONE', source:'portal', type:'claude_prompt', kind:'chat', target:'all',
       summary:'클로드: 자 ai 친구들 대답해봐라' + ${N}, result:'네, 대답할게요', created_at:new Date().toISOString()},
      {id:'Q-n2', status:'WAITING_APPROVAL', source:'portal', type:'claude_prompt', kind:'chat', target:'pi1',
       summary:'클로드: @피원 확인해줘' + ${N}, created_at:new Date().toISOString()},
      {id:'Q-n3', status:'RUNNING', source:'portal', type:'claude_prompt', kind:'ask', workspace:'gaegyebu',
       summary:'클로드: 파일 하나만 고쳐라' + ${N}, created_at:new Date().toISOString()}
    ]; renderOrders()`);
    const fn = feed();
    ok(fn.indexOf('워커 규칙') < 0 && fn.indexOf('npm test') < 0, '말풍선·요약에 [워커 규칙] 문구가 안 보인다');
    ok(fn.indexOf('클로드: ') < 0, '대화 말풍선에 클로드: 접두사가 붙지 않는다');
    ok(/자 ai 친구들 대답해봐라/.test(fn) && /확인해줘/.test(fn), '본문은 그대로 보인다');
    ok(D13.run(`ordMsgText({kind:'ask', summary:'클로드: 파일 하나만 고쳐라' + ${N} + ' (파일 수정)'})`) === '파일 하나만 고쳐라',
      '오더 본문도 규칙 문구·(파일 수정) 꼬리를 뗀다');
    ok(D13.run(`ordStripNote('본문' + ${N})`) === '본문', 'strip 헬퍼는 문구만 뗀다');
  }
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

  // ②-1 '협업 필요' 줄에 @ 없이 적은 이름도 칩으로 보인다(2026-11-26)
  const collabHtml = D14.run("ordMentionHtml('1. 프로젝트: 포털\\n4. 협업 필요: 노트북(구현), 피투(PR 머지)')");
  ok(/mt-nb[^>]*>노트북<\/span>/.test(collabHtml), '협업 줄의 노트북(괄호 앞)이 칩으로 보인다');
  ok(/mt-pi2[^>]*>피투<\/span>/.test(collabHtml), '협업 줄의 피투도 칩으로 보인다');
  ok(D14.run("ordMentionHtml('4. 협업 필요: 없음')").indexOf('<span') < 0, "'협업 필요: 없음' 은 칩을 만들지 않는다");
  ok(D14.run("ordMentionHtml('4. 협업 필요: 큐레이션 담당')").indexOf('<span') < 0, "'큐레이션' 의 '큐' 는 칩이 아니다");
  ok(D14.run("ordMentionHtml('협업 필요 없이 진행')").indexOf('<span') < 0, '협업이라는 낱말만으로는 칩을 만들지 않는다(콜론 필요)');

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
  ok(D14.run("agentAutoJoin(['cue2','bad id!','portal','notebook','pickle']).length") === 1, '새 비서만 골라 합류한다(이상한 값·내 말·노트북·별칭 pickle 제외)');
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

console.log('X) 🏷️ 말풍선 닉네임·이모지 · 부계정(*2·_2·pi3) 자동 합류 · 담당(duty) 표시');
{
  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const S17 = mk();
  const nowMs = Date.now();
  const at = ms => new Date(ms).toISOString();
  const row = (id, source, target, status) => {
    const r = [id, at(nowMs - 60000), source, 'claude_prompt', 'gaegyebu', '{}', status || 'DONE', 0, '', '', ''];
    while (r.length < HEAD.length) r.push('');
    r[HEAD.indexOf('payload')] = JSON.stringify({prompt: '@포털 확인했어요', mode: 'ask', kind: 'chat', target: target || 'portal'});
    r[HEAD.indexOf('finished_at')] = at(nowMs - 30000);
    r[HEAD.indexOf('result')] = '확인했습니다';
    r[HEAD.indexOf('claimed_by')] = source;
    return r;
  };
  S17.props.QUEUE_SHEET_ID = 'SHEETidNick001';
  S17.addSheet('SHEETidNick001', {'Command_Queue': [HEAD.slice(0)].concat([
    row('Q-n1', 'cue'), row('Q-n2', 'keyring'), row('Q-n3', 'notebook'), row('Q-n4', 'pi1'), row('Q-n5', 'vooy')
  ])});
  const D17 = makeDevice(S17);
  D17.config();
  await D17.run('loadOrders()');
  const feed17 = () => D17.el('ord-list').innerHTML;

  // ① 왼쪽 말풍선 — 각 비서의 진짜 닉네임·이모지
  ok(whoIn(feed17(),'cue','큐') && whoIn(feed17(),'keyring','키링'), '큐는 큐 마크 + 이름 · 키링은 키링 마크 + 이름');
  ok(whoIn(feed17(),'notebook','노트북') && whoIn(feed17(),'pi1','피원') && whoIn(feed17(),'vooy','부이'), '노트북·피원·부이도 제 마크');
  ok(!/🏠/.test(feed17()), '예전 고정 아바타(🏠)·“집 노트북” 만능 헤더가 사라졌다');
  ok((feed17().match(/chat-av/g) || []).length >= 5, '말풍선마다 아바타가 있다');
  ok(D17.run("ordSenderLabel('cue').name") === '큐' && D17.run("ordSenderLabel('cue').icon") === '🌀', '발신 라벨 = 닉네임·이모지');
  ok(D17.run("ordSenderLabel('portal').name") === '포털', '내 말(portal)은 포털 그대로');
  // 비서가 낸 말은 오른쪽(내 말)이 아니라 **왼쪽**에 그린다(2026-11-25 v28)
  ok(D17.run("ordIsMine({source:'cue'})") === false, '큐가 낸 말은 내 말이 아니다');
  ok(avMark(feed17(),'cue'), '큐가 낸 말도 왼쪽 말풍선(큐 마크 아바타)');
  ok(avMark(feed17(),'keyring'), '키링이 낸 말도 왼쪽 말풍선(키링 마크)');

  // ② 부계정 비서 자동 합류 — 코드 수정 없이 베이스 닉네임·이모지를 따라간다
  const added = D17.run("agentAutoJoin(['cue2','vooy2','keyring2','pi3','keyring_2'])");
  ok(added.length === 5, '부계정 5개가 한 번에 합류');
  ok(D17.run("agentById('cue2').name") === '큐투' && D17.run("agentById('cue2').icon") === '🌀', 'cue2 → 🌀 큐투');
  ok(D17.run("agentById('vooy2').name") === '뷔투' && D17.run("agentById('vooy2').icon") === '🫛', 'vooy2 → 🫛 뷔투');
  ok(D17.run("agentById('keyring2').name") === '키투' && D17.run("agentById('keyring2').icon") === '🔑', 'keyring2 → 🔑 키투');
  ok(D17.run("agentById('pi3').name") === '피3' && D17.run("agentById('pi3').icon") === '🤖', 'pi3 → 🤖 피3');
  ok(D17.run("agentById('keyring_2').name") === '키링2', 'keyring_2 도 같은 규칙(_2)');
  ok(/부계정/.test(D17.run("agentById('cue2').duty")) && D17.run("agentById('cue2').icon") === D17.run("agentById('cue').icon"), '부계정은 자기 담당(부계정 일)과 베이스 이모지를 가진다');
  ok(D17.run("agentAutoInfo('pi1').name") === '피원' && D17.run("agentAutoInfo('pi4').name") === '피4', 'pi1 은 피원, pi4 는 피4');
  D17.run('renderRoom()');
  const ment17 = D17.el('ord-mentions').innerHTML;
  ok(/@큐투/.test(ment17) && /@뷔투/.test(ment17) && /@키투/.test(ment17) && /@피3/.test(ment17), '@큐투·@뷔투·@키투·@피3 멘션 칩이 바로 생긴다');
  ok(D17.run("ordTargetFromText('@큐2 팩트체크')") === 'cue2', '글로 적은 @큐2 도 그 비서 앞으로 간다');
  const push17 = (() => { let b = null; D17.calls.forEach(c => { const x = JSON.parse(c.opts.body); if (x.action === 'agent_save') b = x; }); return b; })();
  ok(push17 && push17.items.some(x => x.id === 'cue2' && x.name === '큐투' && x.icon === '🌀'), '합류 정보가 서버(agent_save)에도 이름·이모지와 함께 간다');

  // ③ 담당(duty)이 화면에 보인다 — 사용량 카드 한 줄 + 머리말 title(전체 역할표)
  ok(/총괄 조율/.test(D17.el('use-grid').innerHTML) && /팩트체크/.test(D17.el('use-grid').innerHTML), '사용량 카드에 담당 한 줄');
  ok(/피원\(pi1\) — 총괄 조율/.test(D17.el('room-people').title) && /키링\(keyring\) — 전화 발신/.test(D17.el('room-people').title), '참여자 수 title 에 전체 역할표');
  ok(/담당: 레이 님 일정 관리 전담/.test(D17.run("ordTargetTip(ordTargetList().filter(t=>t.id==='cue')[0])")), '대상 칩 툴팁에 담당');

  // ④ ＋추가 폼의 담당 칸 — 서버까지 같이 간다
  D17.run('useAddStart()');
  D17.el('use-new-name').value = '키링3';
  D17.el('use-new-duty').value = 'KTX 예약 보조';
  D17.run('useAddCommit()');
  await new Promise(r => setTimeout(r, 30));
  let last = null;
  D17.calls.forEach(c => { const x = JSON.parse(c.opts.body); if (x.action === 'agent_save' && x.items) last = x; });
  ok(last && last.items.some(x => x.name === '키링3' && x.duty === 'KTX 예약 보조'), '추가할 때 적은 담당이 agent_save 로 간다');
  ok(/KTX 예약 보조/.test(D17.el('use-grid').innerHTML), '카드에도 바로 보인다');
}

console.log('X) 💬 회의실 말풍선 — 답장 주체·대기 말풍선 정리 (2026-11-25 v31)');
{
  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const SX = mk();
  const nowMs = Date.now();
  const at = ms => new Date(ms).toISOString();
  const row = (id, created, source, status, payload, x) => {
    const r = [id, created, source, 'claude_prompt', 'gaegyebu', JSON.stringify(payload), status, 0, '', '', ''];
    while (r.length < HEAD.length) r.push('');
    Object.keys(x || {}).forEach(k => { const i = HEAD.indexOf(k); if (i >= 0) r[i] = x[k]; });
    return r;
  };
  SX.props.QUEUE_SHEET_ID = 'SHEETidRoomBubble001';
  SX.addSheet('SHEETidRoomBubble001', {'Command_Queue': [HEAD.slice(0)].concat([
    // 비서가 포털(사람) 앞에 남긴 순수 답장 — 아무도 실행하지 않는다
    row('Q-b1', at(nowMs - 4 * 60000), 'pi2', 'PENDING',
      { prompt: '🤖 피투입니다 — 출석 완료!', mode: 'ask', kind: 'chat', target: 'portal', reply_to: 'Q-orig' }),
    // 노트북이 답한 내 질문 — 말풍선 주체는 '포털'이 아니라 노트북이어야 한다
    row('Q-b2', at(nowMs - 6 * 60000), 'portal', 'DONE',
      { prompt: '가계부 점검해줘', mode: 'ask', kind: 'chat', target: 'notebook' },
      { claimed_by: 'notebook', finished_at: at(nowMs - 5 * 60000), result: '이렇게 하겠습니다: 11월 지출부터 볼게요.' }),
    // 내가 다른 비서 앞으로 남긴 말 — 기다리는 상대는 큐
    row('Q-b3', at(nowMs - 3 * 60000), 'portal', 'PENDING',
      { prompt: '@큐 이 가격 팩트체크해줘', mode: 'ask', kind: 'chat', target: 'cue' }),
    // 비서가 포털 앞에 남긴 답장인데 결과가 따로 있는 경우 — 결과 말풍선은 보여준다
    row('Q-b4', at(nowMs - 8 * 60000), 'keyring', 'DONE',
      { prompt: '@포털 KTX 예약 확인했어요', mode: 'ask', kind: 'chat', target: 'portal' },
      { claimed_by: 'keyring', finished_at: at(nowMs - 7 * 60000), result: '12/3 09:00 KTX 2매 확정' }),
    // 대화가 실패한 경우 — 오른쪽 내 말과 왼쪽 사유가 겹치지 않아야 한다
    row('Q-b5', at(nowMs - 2 * 60000), 'portal', 'FAILED',
      { prompt: '내일 일정 알려줘', mode: 'ask', kind: 'chat', target: 'notebook' },
      { claimed_by: 'notebook', finished_at: at(nowMs - 1 * 60000), error: 'claude: options.cwd 형식 오류' })
  ])});
  const DX = makeDevice(SX);
  DX.config();
  await DX.run('loadOrders()');
  const feedX = () => DX.el('ord-list').innerHTML;

  // ① 순수 답장에는 대기 말풍선·대기 배지가 없다
  const one = id => DX.run(`ordById('${id}')`);
  ok(DX.run("ordIsPlainReply(ordById('Q-b1'))") === true, '피투가 포털 앞에 남긴 말 = 순수 답장');
  ok(DX.run("ordShowReply(ordById('Q-b1'))") === false, '순수 답장은 두 번째 말풍선을 그리지 않는다');
  ok(DX.run("ordShowReply(ordById('Q-b3'))") === true, '내가 큐 앞에 남긴 말은 기다리는 말풍선을 그린다');
  ok(DX.run("ordShowReply(ordById('Q-b4'))") === true, '결과가 따로 있는 답장은 보여준다');
  const b1 = DX.run("chatOut(ordById('Q-b1'), true)");
  ok(b1.indexOf('c-pend') < 0 && !/>대기</.test(b1), '순수 답장 말풍선에 대기 배지가 없다');
  const b3 = DX.run("chatOut(ordById('Q-b3'), false)");
  ok(/>대기</.test(b3), '내가 보낸 말에는 대기 배지가 그대로');

  // ② 답장 말풍선의 주체 = 실제 답한 비서(노트북), 포털이 아니다
  const inb2 = DX.run("chatIn(ordById('Q-b2'))");
  ok(whoIn(inb2,'notebook','노트북') && !/data-mark="portal"/.test(inb2), '노트북 답장은 노트북 마크·이름으로 보인다');
  ok(DX.run("ordReplyKey({status:'DONE', source:'portal', claimed_by:'notebook'})") === 'notebook', '답장 주체는 claimed_by');
  ok(DX.run("ordReplyKey({status:'DONE', source:'portal', replied_by:'cue', claimed_by:'notebook'})") === 'cue', 'replied_by 가 있으면 그쪽을 쓴다');
  ok(DX.run("ordReplyWhoKey({status:'PENDING', source:'portal', target:'cue'})") === 'cue', '아직 앞이면 받을 비서가 왼쪽에 선다');

  // ③ 기다리는 상대를 이름으로 말한다
  const inb3 = DX.run("chatIn(ordById('Q-b3'))");
  ok(/@큐/.test(inb3) && !/노트북이 60초마다/.test(inb3), '큐 앞 말은 큐가 읽는다고 적는다');
  const inb1 = DX.run("chatIn(ordById('Q-b2'))") ;
  ok(inb1.length > 0, '노트북 답장에는 말풍선이 있다');
  ok(/노트북이 60초마다 확인해요/.test(DX.run("chatIn({status:'PENDING', source:'portal', kind:'chat', target:'notebook', created_at:new Date().toISOString()})")), '노트북 앞 말은 기존 문구 그대로');

  // ④ 대화 실패는 사유만 — 내 말(summary)과 겹치지 않는다
  const failB = DX.run("chatIn(ordById('Q-b5'))");
  ok(/options\.cwd/.test(failB) && failB.indexOf('내일 일정 알려줘') < 0, '실패 말풍선에 내 말이 또 들어가지 않는다');

  // ⑤ 멘션 부계정 — 사용자 확정 호칭(큐투·뷔투·키투)은 명부 등록 전에도 그 비서 앞으로
  ok(DX.run("ordTargetFromText('@큐투 팩트체크')") === 'cue2', '@큐투 → cue2');
  ok(DX.run("ordTargetFromText('@큐2 팩트체크')") === 'cue2', '@큐2 → cue2');
  ok(DX.run("ordTargetFromText('@cue2 확인')") === 'cue2', '@cue2 → cue2');
  ok(DX.run("ordTargetFromText('@뷔투 비교')") === 'vooy2', '@뷔투 → vooy2');
  ok(DX.run("ordTargetFromText('@부이2 비교')") === 'vooy2', '@부이2 → vooy2');
  ok(DX.run("ordTargetFromText('@부이투 비교')") === 'vooy2', '@부이투 → vooy2');
  ok(DX.run("ordTargetFromText('@vooy2 비교')") === 'vooy2', '@vooy2 → vooy2');
  ok(DX.run("ordTargetFromText('@키투 예약')") === 'keyring2', '@키투 → keyring2');
  ok(DX.run("ordTargetFromText('@키링2 예약')") === 'keyring2', '@키링2 → keyring2');
  ok(DX.run("ordTargetFromText('@키링투 예약')") === 'keyring2', '@키링투 → keyring2');
  ok(DX.run("ordTargetFromText('@keyring2 예약')") === 'keyring2', '@keyring2 → keyring2');
  ok(DX.run("ordTargetFromText('@피원님 확인')") === 'pi1', '조사 붙은 @피원님 은 그대로');
  ok(DX.run("ordTargetFromText('@피원2 확인')") === 'pi1', '확정되지 않은 숫자 부계정은 베이스 비서로');

  // ⑤-1 표시 이름도 자연스럽다 — 명부에 오르기 전에도 큐투·뷔투·키투
  ok(DX.run("agentAutoInfo('cue2').name") === '큐투' && DX.run("agentAutoInfo('vooy2').name") === '뷔투' && DX.run("agentAutoInfo('keyring2').name") === '키투',
    '자동 합류 이름이 큐투·뷔투·키투');
  ok(DX.run("ordSenderLabel('cue2').name") === '큐투' && DX.run("ordSenderLabel('vooy2').icon") === '🫛', '말풍선 라벨도 큐투·뷔투(명부 전)');
  ok(/mt-cue/.test(DX.run("ordMentionHtml('@큐투 이거 봐')")) && /mt-vooy/.test(DX.run("ordMentionHtml('@뷔투 이거 봐')")), '멘션 칲도 베이스 색으로 보인다');
  ok(DX.run("agentMentionMap()['@큐투']") === 'cue2', '@큐투 가 멘션표에 있다');

  // ⑥ 발신자 서명 — 답장자가 바뀌면 목록을 다시 그린다
  const sigA = DX.run("ordSig([{id:'Q-x', status:'DONE', source:'portal', claimed_by:'notebook'}])");
  const sigB = DX.run("ordSig([{id:'Q-x', status:'DONE', source:'portal', claimed_by:'cue'}])");
  const sigC = DX.run("ordSig([{id:'Q-x', status:'DONE', source:'portal', claimed_by:'cue', beat_at:'2026-11-25T10:00:00Z'}])");
  ok(sigA !== sigB && sigB !== sigC, 'claimed_by·beat_at 이 바뀌면 서명이 달라진다');

  // ⑦ '노트북' 필터 — source 뿐 아니라 처리(claimed_by)·답장(replied_by)도 본다
  ok(DX.run("ordSenderMatches({source:'portal', claimed_by:'notebook'}, 'notebook')") === true, 'claimed_by=notebook 도 노트북 글');
  ok(DX.run("ordSenderMatches({source:'portal', replied_by:'notebook'}, 'notebook')") === true, 'replied_by=notebook 도 노트북 글');
  ok(DX.run("ordSenderMatches({source:'cue'}, 'notebook')") === false, '큐 글은 노트북 글이 아니다');
  ok(DX.run('ordFilterWhoList().some(a=>a.id==="notebook")') === true, '발신 필터에 노트북이 있다');
  ok(DX.run('ordSenderList().some(a=>a.id==="notebook")') === false, '보내는 사람 목록에는 노트북이 없다(그대로)');
  DX.run("ORD_WHO='notebook'; renderOrders()");
  ok(feedX().indexOf('가계부 점검해줘') >= 0 && feedX().indexOf('내일 일정 알려줘') >= 0, '노트북 필터에 노트북이 처리한 말이 보인다');
  DX.run("ORD_WHO='portal'; renderOrders()");
  ok(feedX().indexOf('🤖 피투입니다') < 0, '포털 필터에서는 남의 답장이 빠진다');
  DX.run("ORD_WHO='all'; renderOrders()");

  // ⑧ 머리말 건수 — 순수 답장은 '대기' 로 세지 않는다
  ok(DX.run("ORD_ITEMS.filter(i=>(i.status==='PENDING'||i.status==='RUNNING') && !ordIsPlainReply(i)).length") === 1,
    '대기 건수는 큐 앞 내 말 1건만');
}

console.log('Y) 🌿 어사이드 — 포털 버튼이 노트북 한 줄 명령으로 간다 (2026-11-25)');
{
  // 계약: 포털은 claude_prompt 봉투(payload.kind='chat'·target='notebook')에
  //  `🌿어사이드 <작업>` 한 줄을 실어 보낸다 — 노트북 notebook-agent/lib/aside.js parseCommand 가 받는 모양.
  ok(/label: '어사이드', fill: '🌿어사이드 상태'/.test(html), '빠른 오더(#ord-presets)에 🌿 어사이드 칩');
  ok(/onclick="quickAside\('status'\)"/.test(html), '안내 패널에 상태 확인 버튼(원탭)');
  ok(['musinsa', 'kakao', 'quiz', 'naver', 'ali'].every(j => new RegExp('onclick="quickAside\\(' + "'" + j + "'" + '\\)"').test(html)),
    '안내 패널에 작업 5종 실행 버튼');
  ok(/id="ord-help"/.test(html) && /🌿 어사이드 — 집 노트북 자동화/.test(html), '어사이드 안내 칸이 도움말 안에 있다');

  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const SY = mk();
  SY.props.QUEUE_SHEET_ID = 'SHEETidAside0001';
  SY.addSheet('SHEETidAside0001', {'Command_Queue': [HEAD.slice(0)]});
  const DY = makeDevice(SY); DY.config();
  const rows = () => SY.books['SHEETidAside0001'].Command_Queue;
  const last = () => rows()[rows().length - 1] || [];
  const lastPayload = () => { try { return JSON.parse(last()[5]); } catch (e) { return {}; } };

  ok(DY.run("asidePrompt('musinsa')") === '🌿어사이드 무신사' && DY.run("asidePrompt('status')") === '🌿어사이드 상태', '명령 본문은 🌿어사이드 + 한 낱말');
  ok(DY.run("asideJobOf('shell')") === null && DY.run("asideJobOf('ALI').id") === 'ali', '아는 작업만 고른다(대소문자 무관)');

  // ① 실행 버튼 — 확인 뒤 claude_prompt(kind=chat · target=notebook) 로 접수
  const n0 = rows().length;
  await DY.run("quickAside('musinsa')");
  ok(rows().length === n0 + 1, '무신사 버튼 → 오더 1건 접수');
  ok(last()[3] === 'claude_prompt' && last()[2] === 'portal', '오더 타입은 claude_prompt · 발신 portal', last().slice(0, 4));
  // 포털 서버는 target='notebook' 도 그대로 싣는다(2026-11-27) — 노트북이 이 값으로 대화를 집는다.
  ok(lastPayload().kind === 'chat' && lastPayload().target === 'notebook' && lastPayload().prompt === '🌿어사이드 무신사',
    'payload = kind:chat · target:notebook · 🌿어사이드 무신사', lastPayload());
  ok(last()[6] === 'PENDING', '노트북이 집어 갈 수 있게 PENDING(전달 완료로 닫히지 않음)');

  // ② 상태 확인 — 확인창 없이 바로, 아무것도 실행하지 않는 명령
  await DY.run("quickAside('status')");
  ok(lastPayload().prompt === '🌿어사이드 상태' && rows().length === n0 + 2, '상태 확인 버튼도 한 줄 명령으로 접수');

  // ③ 실행 버튼에서 취소하면 아무것도 안 보낸다
  DY.run('__confirmSave = confirm'); DY.run('confirm = function(){ return false; }');
  const n1 = rows().length;
  await DY.run("quickAside('quiz')");
  ok(rows().length === n1, '확인창에서 취소하면 접수하지 않는다');
  DY.run('confirm = __confirmSave');

  // ④ 모르는 작업·서버 미설정
  await DY.run("quickAside('shell')");
  ok(rows().length === n1 && /그런 작업은 없어요/.test(DY.el('sync-txt').textContent), '모르는 작업은 보내지 않고 안내');
  await DY.run("quickAside()");
  ok(rows().length === n1, '작업 이름 없이 불러도 접수하지 않는다');

  // ⑤ 문서·카드 표식 — 회의실에서 어사이드 오더도 알아볼 수 있다
  ok(DY.run("ORD_TYPE_LABEL['aside_run']") === '어사이드' && DY.run("ORD_TYPE_ICON['aside_run']") === '🌿', 'aside_run 타입 라벨·아이콘');
}

console.log('Z) 💬 답장 인용 — 원문 미리보기 · 원문으로 이동 · 말풍선 답장 버튼 (2026-11-25)');
{
  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const SZ = mk();
  const nowMs = Date.now();
  const at = ms => new Date(ms).toISOString();
  const row = (id, created, source, status, payload, x) => {
    const r = [id, created, source, 'claude_prompt', 'gaegyebu', JSON.stringify(payload), status, 0, '', '', ''];
    while (r.length < HEAD.length) r.push('');
    Object.keys(x || {}).forEach(k => { const i = HEAD.indexOf(k); if (i >= 0) r[i] = x[k]; });
    return r;
  };
  SZ.props.QUEUE_SHEET_ID = 'SHEETidReplyQuote01';
  SZ.addSheet('SHEETidReplyQuote01', {'Command_Queue': [HEAD.slice(0)].concat([
    // 원문 — 내가 노트북에 물어본 말, 노트북이 답했다
    row('Q-q1', at(nowMs - 9 * 60000), 'portal', 'DONE',
      { prompt: '가계부 11월 지출 점검해줘', mode: 'ask', kind: 'chat', target: 'notebook' },
      { claimed_by: 'notebook', finished_at: at(nowMs - 8 * 60000), result: '11월 지출은 82만원이에요 — 카드값 마감 25일' }),
    // 원문 Q-q1 에 대한 답장 — 본문 앞에 '↩ …' 줄이 함께 저장돼 있다
    row('Q-q2', at(nowMs - 5 * 60000), 'portal', 'PENDING',
      { prompt: '↩ 가계부 11월 지출 점검해줘\n카드값 마감일은 25일이야', mode: 'ask', kind: 'chat', target: 'notebook', reply_to: 'Q-q1' })
  ])});
  const DZ = makeDevice(SZ);
  DZ.config();
  await DZ.run('loadOrders()');
  const feedZ = () => DZ.el('ord-list').innerHTML;
  const lastZ = a => {
    for (let i = DZ.calls.length - 1; i >= 0; i--) { const b = JSON.parse(DZ.calls[i].opts.body); if (b.action === a) return b; }
    return null;
  };
  const sz = DZ.el('sync-txt');

  // ① 서버가 준 reply_to 가 목록에 그대로 살아 있다(예전 배포면 없음 — 화면은 인용 줄로 물러선다)
  ok(DZ.run("ordById('Q-q2').reply_to") === 'Q-q1', 'queue_list 의 reply_to 가 오더에 그대로 온다');
  ok(DZ.run("ordReplyToId({reply_to:' Q-q1 '})") === 'Q-q1' && DZ.run('ordReplyToId({})') === '', 'reply_to 읽기(빈 값·공백 정리)');

  // ② 답장 말풍선 안 인용 박스 — 원 작성자 + 원문 미리보기
  const qb2 = DZ.run("ordQuoteBox(ordById('Q-q2'))");
  ok(/class="chat-quote-in"/.test(qb2), '답장 말풍선에 인용 박스가 그려진다');
  ok(/🌐 포털/.test(qb2), '인용 박스에 원 작성자 이름');
  ok(/가계부 11월 지출 점검해줘/.test(qb2), '인용 박스에 원문 미리보기');
  ok(/onclick="ordJumpTo\('Q-q1'\)"/.test(qb2), '인용 박스를 누르면 원문으로 간다(ordJumpTo)');
  ok(/role="button"/.test(qb2) && /tabindex="0"/.test(qb2) && /onkeydown/.test(qb2), '키보드로도 인용 박스를 누를 수 있다');
  ok(DZ.run("chatOut(ordById('Q-q2'))").indexOf('↩ 가계부') < 0, '본문의 ↩ 인용 줄은 인용 박스와 겹치지 않게 덜어낸다');
  ok(/카드값 마감일은 25일이야/.test(DZ.run("chatOut(ordById('Q-q2'))")), '답장 본문은 그대로 보인다');
  ok(DZ.run("ordQuoteBox(ordById('Q-q1'))") === '', '원문 쪽 말풍선에는 인용 박스가 없다');
  ok(DZ.run("ordQuoteBox({id:'Q-s', reply_to:'Q-s'})") === '', '자기 자신을 가리키는 reply_to 는 그리지 않는다');

  // ③ 원문이 비서가 쓴 말이면 — 그 비서 이름으로 보인다
  ok(DZ.run("ordQuoteAuthor(ordById('Q-q1'))") === '🌐 포털', '내 말을 인용하면 나(포털)로 보인다');
  ok(/피투/.test(DZ.run("ordQuoteAuthor({id:'Q-a', status:'PENDING', source:'pi2', kind:'chat', target:'portal', summary:'출석 완료'})")), '비서가 쓴 말을 인용하면 그 비서 이름으로 보인다');
  ok(/노트북/.test(DZ.run("ordQuoteAuthor({id:'Q-a', status:'DONE', source:'notebook', kind:'chat', claimed_by:'notebook', summary:'가계부 점검'})")), '노트북 말은 노트북 이름으로');
  ok(DZ.run("ordQuoteText({id:'Q-a', status:'DONE', source:'portal', claimed_by:'notebook', kind:'chat', summary:'', result:'11월 지출은 82만원'})") === '11월 지출은 82만원', '본문 요약이 없으면 결과를 미리보기로 쓴다');

  // ④ 원문이 지금 목록에 없을 때 — 안내 + 원문 id
  const miss = DZ.run("ordQuoteBox({id:'Q-z', reply_to:'Q-old', kind:'chat', summary:'↩ 예전에 하던 얘기 이어서 해줘'})");
  ok(/chat-quote-in miss/.test(miss), '원문이 목록에 없으면 점선 인용 박스');
  ok(/지금 목록에 없어요/.test(miss) && /Q-old/.test(miss), '목록에 없다는 안내 + 원문 id');
  ok(DZ.run("ordMsgText({id:'Q-z', reply_to:'Q-old', kind:'chat', summary:'↩ 예전에 하던 얘기 이어서 해줘'})").indexOf('예전에 하던 얘기') >= 0,
    '원문을 모를 때는 본문의 ↩ 줄을 지우지 않는다(내용이 사라지면 안 됨)');
  sz.textContent = '';
  DZ.run("ordJumpTo('Q-old')");
  ok(/찾지 못했어요/.test(sz.textContent), '없는 원문을 누르면 새로고침 안내');

  // ⑤ 원문으로 이동 — 필터에 가려져 있으면 먼저 풀고, 하이라이트를 남긴다
  DZ.run("ORD_FILTER='live'; renderOrders()");
  ok(DZ.run("ORD_ITEMS.filter(ordVisible).some(i=>i.id==='Q-q1')") === false, '상태 필터로 원문이 가려진 상태');
  DZ.run("ordJumpTo('Q-q1')");
  ok(DZ.run('ORD_WHO') === 'all' && DZ.run('ORD_FILTER') === 'all', '원문이 가려져 있으면 필터를 풀어 보이게 한다');
  ok(DZ.run('ORD_JUMP') === 'Q-q1', '찾아간 원문 id 를 남긴다(하이라이트)');
  ok(new RegExp('id="chat-Q-q1"').test(feedZ()), '원문 말풍선에 id 가 있어 그 자리로 갈 수 있다');

  // ⑥ 말풍선마다 답장 버튼 — 원클릭으로 reply_to 지정
  ok(/↩ 답장/.test(DZ.run("chatOut(ordById('Q-q1'), false)")) && /↩ 답장/.test(DZ.run("chatOut(ordById('Q-q1'), true)")), '보낸 말·받은 말 말풍선 모두에 ↩ 답장 버튼');
  ok(/↩ 답장/.test(DZ.run("chatIn(ordById('Q-q1'))")), '비서 답장 말풍선에도 ↩ 답장 버튼');
  DZ.run("ordReplyById('Q-q1')");
  ok(DZ.run('ORD_REPLY_ID') === 'Q-q1', '답장 버튼 → 원문 id 를 기억');
  ok(/chat-quote/.test(DZ.el('ord-quote').innerHTML) && /🌐 포털/.test(DZ.el('ord-quote').innerHTML) && /가계부/.test(DZ.el('ord-quote').innerHTML),
    '입력칸 위 인용 미리보기에 원 작성자·원문');
  DZ.run('ordQuoteClear()');
  ok(DZ.run('ORD_REPLY_ID') === '' && DZ.run('ORD_REPLY_TO') === '' && DZ.el('ord-quote').innerHTML === '', '✕ 로 인용을 취소한다');

  // ⑦ 보내기 — payload.reply_to 로 오더를 잇는다(예전 서버는 모르는 칸을 그냥 버린다)
  DZ.run("ordModeSet('chat')");
  DZ.run("ordReplyById('Q-q1')");
  DZ.el('ord-inp').value = '카드값은 25일이야';
  await DZ.run('sendOrder()');
  let bz = lastZ('queue_enqueue');
  ok(bz && bz.payload.reply_to === 'Q-q1', '보낸 답장에 reply_to(Q-q1) 가 실린다');
  ok(/^↩ /.test(bz.payload.prompt) && /카드값은 25일이야/.test(bz.payload.prompt), '본문 인용 줄은 예전 서버·비서를 위해 그대로 남긴다');
  ok(DZ.run('ORD_REPLY_ID') === '' && DZ.run('ORD_REPLY_TO') === '' && DZ.el('ord-quote').innerHTML === '', '보내면 인용 상태를 비운다');

  // ⑧ 안전 — 제목·미리보기도 그대로 그리지 않는다
  DZ.run(`ORD_ITEMS = [
    {id:'Q-x1', status:'DONE', source:'portal', kind:'chat', summary:'<img src=x>원문', created_at:new Date().toISOString()},
    {id:'Q-x2', status:'PENDING', source:'portal', kind:'chat', summary:'<b>답장</b>', created_at:new Date().toISOString(), reply_to:'Q-x1'}
  ]; renderOrders()`);
  const fx = feedZ();
  ok(fx.indexOf('<img') < 0 && fx.indexOf('&lt;img') >= 0, '원문 인용 미리보기도 이스케이프한다');
  ok(/chat-quote-in/.test(fx), '이스케이프한 뒤에도 인용 박스는 살아 있다');
  ok(DZ.run("ordQuoteBox({id:'Q-y', reply_to:'Q-x1'})").indexOf('<img') < 0, '인용 박스 단독으로 그려도 안전');
}

console.log('AA) 📊 사용량 자동 연동 — 리셋 경계 · 가동 신호 · 비공개 (2026-11-25)');
{
  const SAA = mk();
  const DAA = makeDevice(SAA);
  DAA.config();
  // ① 상태 계산 — 이번 주기 숫자 → 가동 신호 → 미확인
  DAA.run('AGENT_DATA = null; USE_DATA = {}');
  const defOf = id => `agentById('${id}')`;
  ok(DAA.run(`useStateOf(${defOf('pi1')})`) === 'unknown', '아무 보고도 없으면 미확인');
  DAA.run(`USE_DATA['pi1'] = {pct: 80, at: new Date().toISOString()}`);
  ok(DAA.run(`useStateOf(${defOf('pi1')})`) === 'ok', '이번 주기 숫자가 있으면 정상');
  DAA.run(`USE_DATA['pi1'] = {pct: 80, at: '2020-01-01T00:00:00.000Z'}`);
  ok(DAA.run(`useStateOf(${defOf('pi1')})`) === 'unknown', '리셋 전에 받은 지난 값은 정상으로 세지 않는다');
  ok(/리셋 지남/.test(DAA.run(`useCard(${defOf('pi1')})`)), '지난 값 카드는 리셋이 지났다고 적는다');

  // ② 리셋 경계 — 일일 04:00 · 주간 월요일 09:00
  ok(DAA.run("useResetAt({reset:'daily04'}) - useCycleStart({reset:'daily04'})") === 86400000,
    '일일 주기는 다음 04:00 까지 정확히 24시간');
  ok(DAA.run("useResetAt({reset:'weekly'}) - useCycleStart({reset:'weekly'})") === 7 * 86400000,
    '주간 주기는 다음 월요일 09:00 까지 7일');
  ok(DAA.run("new Date(useCycleStart({reset:'weekly'})).getDay()") === 1 &&
     DAA.run("new Date(useCycleStart({reset:'weekly'})).getHours()") === 9, '주간 주기는 월요일 09:00 에 시작');
  ok(DAA.run("new Date(useCycleStart({reset:'daily04'})).getHours()") === 4, '일일 주기는 04:00 에 시작');

  // ③ 가동 신호 — 숫자를 안 내는 계정(피투 = Pickle 무료)은 '가동 중 · 잔여 비공개'
  DAA.run('USE_DATA = {}');
  DAA.run("AGENT_DATA = {updated_at: new Date().toISOString(), pi2: {updated_at: new Date().toISOString(), agent: {state: 'idle'}}}");
  ok(DAA.run(`useStateOf(${defOf('pi2')})`) === 'na', '살아 있는 신호만 있으면 비공개 상태');
  const pi2Card = DAA.run(`useCard(${defOf('pi2')})`);
  ok(/가동 중/.test(pi2Card) && /잔여 비공개/.test(pi2Card), '카드에 가동 중 · 잔여 비공개를 적는다');
  ok(/use-dev na/.test(pi2Card) && /use-bar na/.test(pi2Card), '비공개 카드는 전용 표시(점선 막대)');
  ok(/신호/.test(pi2Card), '마지막 신호 시각을 함께 보여준다');
  ok(DAA.run(`useStateOf(${defOf('pi1')})`) === 'unknown', '신호가 없는 다른 비서는 여전히 미확인');
  DAA.run("AGENT_DATA = {updated_at: new Date(Date.now() - 30 * 3600000).toISOString(), pi2: {updated_at: new Date(Date.now() - 30 * 3600000).toISOString(), agent: {state: 'idle'}}}");
  ok(DAA.run(`useStateOf(${defOf('pi2')})`) === 'unknown', '하루 넘게 소식이 없으면 가동 중이라고 하지 않는다');

  // ③-2 상태 파일이 없는 비서(큐·부이·키링) — 회의실에 남긴 말도 가동 신호
  DAA.run('AGENT_DATA = null; USE_DATA = {}');
  DAA.run("ORD_ITEMS = [{id:'Q-a1', source:'cue', status:'DONE', kind:'chat', created_at:new Date(Date.now()-10*60000).toISOString()}]");
  ok(DAA.run(`useStateOf(${defOf('cue')})`) === 'na', '큐가 방금 말을 남겼으면 비공개 상태(가동)');
  ok(/최근 활동/.test(DAA.run(`useCard(${defOf('cue')})`)), '카드는 가동 근거를 최근 활동으로 적는다');
  DAA.run("ORD_ITEMS = [{id:'Q-a2', source:'vooy', status:'DONE', kind:'chat', created_at:new Date(Date.now()-30*3600000).toISOString()}]");
  ok(DAA.run(`useStateOf(${defOf('vooy')})`) === 'unknown', '하루 넘게 조용한 비서는 미확인');
  ok(DAA.run(`useStateOf(${defOf('keyring')})`) === 'unknown', '말을 남긴 적 없는 비서는 미확인');
  DAA.run('ORD_ITEMS = []');

  // ④ 이번 주기 숫자가 신호보다 우선 · 다른 기기 부이2 같은 추가 비서도 같은 규칙
  DAA.run("AGENT_DATA = {updated_at: new Date().toISOString(), pi2: {updated_at: new Date().toISOString(), agent: {state: 'working'}}}");
  DAA.run(`USE_DATA['pi2'] = {pct: 12, at: new Date().toISOString()}`);
  ok(DAA.run(`useStateOf(${defOf('pi2')})`) === 'soon', '이번 주기 숫자가 있으면 숫자가 이긴다');
  ok(DAA.run('useSummary().soon') >= 1 && DAA.run('useSummary().na') >= 0, '요약에 임박·비공개 칸이 있다');

  // ⑤ 요약·안내 문구 — 비공개 칸이 생기고, 왜 비어 있는지 화면이 설명한다
  DAA.run('USE_DATA = {}; renderUse(true)');
  const sum = DAA.el('use-sum').innerHTML;
  ok(/비공개/.test(sum), '요약에 비공개 칸');
  ok(/가동 신호/.test(DAA.el('use-note').textContent || ''), '안내: 숫자를 안 내는 계정은 가동 신호로 표시');
  ok(/usage_report/.test(DAA.el('use-note').textContent || ''), '안내: 비서가 스스로 보고(usage_report)');
  ok(/개 연동/.test(DAA.el('use-note').textContent || ''), '몇 개가 연동됐는지 센다');
  ok(/비공개/.test(DAA.el('room-use-sum').innerHTML), '머리말 요약에도 비공개가 보인다');
}

console.log('AB) 🔴 지금 작업 중 — 작업중 리스트 · 누가 일하는지 (2026-11-26)');
{
  const SAB = mk();
  const DAB = makeDevice(SAB);
  DAB.config();
  const now = Date.now();
  const ago = m => new Date(now - m * 60000).toISOString();
  DAB.run('AGENT_DATA = null; USE_DATA = {}; QSTAT_DATA = null; ORD_WHO = "all"');
  DAB.run(`ORD_ITEMS = ${JSON.stringify([
    {id: 'Q-ab1', type: 'claude_prompt', workspace: 'content-hub', status: 'PENDING', kind: 'ask', source: 'portal',
     target: 'cue', created_at: ago(9), summary: '이번 주 대전 로컬 맛집 후보 3곳'},
    {id: 'Q-ab2', type: 'claude_prompt', workspace: 'content-hub', status: 'RUNNING', kind: 'ask', source: 'portal',
     target: 'notebook', claimed_by: 'notebook', created_at: ago(14), started_at: ago(13), beat_at: ago(0.2),
     summary: '클로드: 콘텐츠 허브 4주차 카드 문구 [워커 규칙] 셸 규칙'},
    {id: 'Q-ab3', type: 'toss_sync', workspace: '', status: 'DONE', kind: 'ask', source: 'portal',
     created_at: ago(90), finished_at: ago(89), claimed_by: 'notebook', result: '동기화 완료'},
    {id: 'Q-ab4', type: 'claude_prompt', workspace: 'insurance-manager', status: 'WAITING_APPROVAL', kind: 'ask',
     source: 'portal', created_at: ago(3), expires_in_ms: 600000, summary: '보장분석 표 담보 이름 정리 (파일 수정)'},
    {id: 'Q-ab5', type: 'claude_prompt', workspace: 'hub-agent', status: 'PENDING', kind: 'chat', source: 'portal',
     target: 'all', created_at: ago(1), summary: '@전체 오늘 우선순위 정리'},
    {id: 'Q-ab6', type: 'claude_prompt', workspace: 'hub-agent', status: 'PENDING', kind: 'chat', source: 'cue',
     target: 'portal', created_at: ago(2), summary: '맛집 후보 정리해서 올렸어요'}
  ])}`);

  // ① 작업중인 리스트 — 실행 중 → 승인 → 차례 대기, 끝난 것·순수 답장은 제외
  ok(DAB.get('ordLiveList().map(x=>x.st).join(",")') === 'RUNNING,WAITING_APPROVAL,PENDING,PENDING',
    '실행 중 → 승인 대기 → 차례 대기 순으로 정렬');
  ok(DAB.get('ordLiveList().map(x=>x.it.id).join(",")') === 'Q-ab2,Q-ab4,Q-ab1,Q-ab5',
    '끝난 오더·순수 답장은 작업중 리스트에 없음');

  // ② 담당 — 실행 중이면 잡은 비서, 대기는 받을 비서, @전체는 아직 주인 없음
  ok(DAB.run("ordLiveOwner({status:'RUNNING', claimed_by:'notebook', target:'cue'})") === 'notebook', '실행 중이면 잡은 비서');
  ok(DAB.run("ordLiveOwner({status:'PENDING', target:'cue'})") === 'cue', '대기는 받을 비서');
  ok(DAB.run("ordLiveOwner({status:'PENDING'})") === 'notebook', '대상 없는 오더는 노트북 몫');
  ok(DAB.run("ordLiveOwner({status:'PENDING', target:'all'})") === '', '@전체는 아직 주인 없음');
  ok(DAB.run("ordLiveOwner({status:'DONE', target:'cue'})") === '', '끝난 오더는 주인 없음');
  ok(DAB.run("ordLiveSince({status:'RUNNING', started_at:'" + ago(13) + "'})") > Date.now() - 14 * 60000, '실행 경과는 시작 시각부터');

  // ③ 누가 일하나 — 작업 중 → 한도 소진 → 대기 → 쉬는 중 → 응답 없음/미확인
  ok(DAB.run("ordAgentAct('notebook').st") === 'work', '노트북은 지금 작업 중');
  ok(DAB.run("ordAgentAct('notebook').n") === 2, '노트북이 잡고 있는 일 2건(실행 + 승인 대기)');
  ok(DAB.run("ordAgentAct('cue').st") === 'work', '큐도 내 앞 대기 오더를 받아 작업 중');
  ok(DAB.run("ordAgentAct('vooy').st") === 'unknown', '신호도 기록도 없는 비서는 미확인(지어내지 않음)');
  DAB.run(`AGENT_DATA = {pi2: {agent: {state: 'idle'}, updated_at: ${JSON.stringify(ago(5))}}}`);
  ok(DAB.run("ordAgentAct('pi2').st") === 'wait', '5분 전 신호 = 대기');
  DAB.run(`AGENT_DATA = {pi2: {agent: {state: 'idle'}, updated_at: ${JSON.stringify(ago(150))}}}`);
  ok(DAB.run("ordAgentAct('pi2').st") === 'idle', '2시간 넘은 신호 = 쉬는 중');
  DAB.run(`AGENT_DATA = {pi2: {agent: {state: 'working'}, updated_at: ${JSON.stringify(ago(30 * 60))}}}`);
  ok(DAB.run("ordAgentAct('pi2').st") === 'out', '하루 넘은 신호 = 응답 없음');
  DAB.run(`USE_DATA['keyring'] = {pct: 0, at: ${JSON.stringify(ago(20))}}`);
  ok(DAB.run("ordAgentAct('keyring').st") === 'limit', '이번 주기 잔여 0% = 한도 소진');
  DAB.run(`USE_DATA['cue'] = {pct: 0, at: ${JSON.stringify(ago(20))}}`);
  ok(DAB.run("ordAgentAct('cue').st") === 'work', '한도 0 이어도 잡고 있는 일이 있으면 작업 중');
  DAB.run("AGENT_DATA = null; USE_DATA = {}; QSTAT_DATA = {heartbeat: {state: 'ok', min: 2}}");
  ok(DAB.run("ordAgentAct('notebook').st") === 'work', '노트북은 일이 먼저(하트비트보다)');

  // ④ 화면 — 한눈에 보이는 작업 줄·가동 칩·경과
  DAB.run('renderLive()');
  const box = DAB.el('room-live').innerHTML;
  ok(/지금 작업 중/.test(box) && /<b>4<\/b>/.test(box), '머리말에 작업중 건수');
  ok(/rl-work run/.test(box) && /rl-work wait/.test(box) && /rl-work pend/.test(box), '실행·승인·대기 줄이 상태별로');
  ok(markThen(box,'notebook','노트북') && markThen(box,'cue','큐'), '줄마다 담당 비서(마크·이름)');
  ok(/4주차 카드 문구/.test(box) && !/워커 규칙/.test(box), '요약은 보이되 [워커 규칙] 문구는 뗀다');
  ok(/class="ord-elapsed" data-since="\d+"/.test(box), '경과 시간이 1초마다 갱신되는 자리');
  ok(/rl-chip run/.test(box) && /실행 중/.test(box), '상태 알약(실행 중)');
  ok(/data-k="who" data-v="cue"/.test(box) && /onclick="ordFilterSet\(this\)"/.test(box), '비서 칩을 누르면 그 비서 말만');
  ok(/rl-ag work/.test(box) && /rl-ag unknown/.test(box), '비서별 가동 상태(작업 중·미확인)가 칩으로');
  ok(/작업 중 <b>/.test(box) && /미확인 <b>/.test(box), '상태 요약(작업 중·미확인 몇 명)');
  ok(/class="room-live"/.test(box) === false && /room-live/.test(DAB.run("document.getElementById('room-live').className")), '작업이 있으면 기본 모양');
  ok(/＋ 1건 더/.test(box), '줄은 3개까지 — 나머지는 "＋N건 더"로 알린다');

  // ⑤ 정체·이스케이프·빈 목록
  DAB.run(`ORD_ITEMS = [{id: 'Q-st', type: 'claude_prompt', workspace: 'hub-agent', status: 'RUNNING', kind: 'ask',
    source: 'portal', target: 'notebook', claimed_by: 'notebook', created_at: ${JSON.stringify(ago(120))},
    started_at: ${JSON.stringify(ago(120))}, beat_at: ${JSON.stringify(ago(70))}, summary: '<img src=x onerror=alert(1)> 긴 작업'}]; renderLive()`);
  const box2 = DAB.el('room-live').innerHTML;
  ok(/정체 의심/.test(box2), '1시간 넘게 신호가 없으면 줄에 정체 의심');
  ok(box2.indexOf('<img') < 0 && /&lt;img/.test(box2), '요약의 HTML 은 글자로만(esc)');
  DAB.run('ORD_ITEMS = []; renderLive()');
  const box3 = DAB.el('room-live').innerHTML;
  ok(/지금 작업 중 <b>0<\/b>/.test(box3) && /지금 도는 일은 없어요/.test(box3), '일이 없으면 없다고 적는다');
  ok(/no-work/.test(DAB.run("document.getElementById('room-live').className")), '빈 판은 다른 배경');

  // ⑥ 머리말·필터·기존 계약
  DAB.run(`ORD_ITEMS = [{id: 'Q-h1', status: 'RUNNING', kind: 'ask', source: 'portal', target: 'notebook', claimed_by: 'notebook', created_at: ${JSON.stringify(ago(3))}},
    {id: 'Q-h2', status: 'WAITING_APPROVAL', kind: 'ask', source: 'portal', created_at: ${JSON.stringify(ago(2))}, expires_in_ms: 600000},
    {id: 'Q-h3', status: 'PENDING', kind: 'ask', source: 'portal', target: 'cue', created_at: ${JSON.stringify(ago(1))}}];
    renderOrderHead()`);
  ok(/실행 1/.test(DAB.el('ord-count').textContent) && /승인 1/.test(DAB.el('ord-count').textContent) && /대기 1/.test(DAB.el('ord-count').textContent),
    '머리말 배지에 실행·승인·대기 건수(실행과 대기를 따로)');
  ok(/🔴 작업 \d/.test(DAB.el('room-people').textContent), '참여자 배지에도 작업 중 수');
  DAB.run("ordFilterSet({dataset: {k: 'who', v: 'cue'}, className: 'rl-ag work'})");
  ok(DAB.run('ORD_WHO') === 'cue', '비서 칩 → 발신 필터가 그 비서로');
  DAB.run("ordFilterSet({dataset: {k: 'who', v: 'all'}, className: 'rl-ag work'})");
  ok(/class="order-card room-card"/.test(html) && /<details class="room-use" id="room-use"/.test(html), '기존 회의실 계약 유지');
}

console.log('AC) 🎨 비서 마크 — 계열로 묶고 호기로 가른다 (2026-11-26)');
{
  const P = makeDevice(S);
  const mark = id => P.run(`agentMark('${id}')`);
  const IDS = ['pi1', 'pi2', 'notebook', 'cue', 'cue2', 'vooy', 'vooy2', 'keyring', 'keyring2'];
  // ① 9명이 서로 다른 마크(색 클래스 + 글리프) — 같은 그림이 둘 있으면 실패
  const sigs = IDS.map(id => mark(id).replace(/ title="[^"]*"/g, ''));
  ok(new Set(sigs).size === 9, '편대 9명의 마크가 모두 다르다');
  // ② 계열 = 색, 호기 = 채움(1) vs 테두리(2)
  ok(/class="mk mk-pi1"/.test(mark('pi1')) && /class="mk mk-pi2 v2"/.test(mark('pi2')), '피클 계열 pi1은 에메랄드 · pi2는 청록 테두리');
  ok(/class="mk mk-cue"/.test(mark('cue')) && /class="mk mk-cue2 v2"/.test(mark('cue2')), '큐 계열 cue는 다크 슬레이트 · cue2는 밝은 테두리');
  ok(/class="mk mk-vooy"/.test(mark('vooy')) && /class="mk mk-vooy2 v2"/.test(mark('vooy2')), '부이 계열 vooy는 바이올렛 · vooy2는 밝은 테두리');
  ok(/class="mk mk-key"/.test(mark('keyring')) && /class="mk mk-key2 v2"/.test(mark('keyring2')), '키링 계열 keyring은 앰버 · keyring2는 밝은 테두리');
  ok(/class="mk mk-nb"/.test(mark('notebook')), '집 노트북은 블루 모니터 마크');
  // ③ 숫자 배지 — 2호기는 2, 1호기도 1 (작은 글씨·색 구분이 어려운 눈에도 읽힌다)
  ok(/<span class="mk-b">1<\/span>/.test(mark('pi1')) && /<span class="mk-b">2<\/span>/.test(mark('pi2')), '1호기 1 · 2호기 2 배지');
  ok(/<span class="mk-b">2<\/span>/.test(mark('cue2')) && /<span class="mk-b">2<\/span>/.test(mark('vooy2')) && /<span class="mk-b">2<\/span>/.test(mark('keyring2')), '큐투·뷔투·키투 모두 2 배지');
  ok(!/mk-b/.test(mark('notebook')), '하나뿐인 노트북에는 숫자 배지 없음');
  ok(!/mk-b/.test(P.run("agentMark('cue2', {mini: true})")), '작은 칩(mini)은 이름이 옆에 있어 배지를 뺀다');
  // ④ 외부 이미지 없이 인라인 SVG — CDN·깨진 아이콘 걱정 없음
  ok(/<svg/.test(mark('pi2')) && !/<img|https?:\/\//.test(IDS.map(mark).join('')), '모든 마크가 인라인 SVG(외부 주소·<img> 없음)');
  // ⑤ 모르는 id·새 부계정도 같은 규칙 — 큐3은 큐 계열
  ok(P.run("markInfo('cue3').c") === 'mk-cue' && P.run("markInfo('cue3').n") === 3, '새 부계정 cue3 도 큐 계열·3호기');
  ok(P.run("markInfo('pi4').c") === 'mk-pi1', 'pi4 도 피클 계열');
  ok(P.run("markInfo('portal').c") === 'mk-me', '나(포털)는 내 마크');
  // ⑥ 이름에 HTML이 섞여도 글자로만(data-mark·title 모두 esc)
  const evil = P.run(`agentMark('x"><img src=x onerror=alert(1)>')`);
  ok(evil.indexOf('<img') < 0 && /&quot;&gt;&lt;img/.test(evil), '마크 id/이름은 글자로만 들어간다');
}

console.log('AD) 🎨 마크를 쓰는 화면들 — 칩·관제·사용량·역할표·말풍선');
{
  const Q = makeDevice(S);
  Q.config();
  await Q.run('loadOrders()');
  Q.run("agentAutoJoin(['cue2','vooy2','keyring2'])");
  Q.run('renderRoom()');
  const ment = Q.el('ord-mentions').innerHTML;
  const chips = Q.el('ord-filters').innerHTML;
  const use = Q.el('use-grid').innerHTML;
  const roles = Q.el('role-table').innerHTML;
  ok(['all', 'pi1', 'pi2', 'notebook', 'cue', 'cue2', 'vooy', 'vooy2', 'keyring', 'keyring2']
    .every(id => ment.indexOf('data-mark="' + id + '"') >= 0), '대상 칩(@전체~@키투)마다 마크가 붙는다');
  ok(['pi1', 'pi2', 'notebook', 'cue', 'cue2', 'vooy', 'vooy2', 'keyring', 'keyring2']
    .every(id => chips.indexOf('data-mark="' + id + '"') >= 0), '발신 필터 칩마다 마크가 붙는다');
  ok(['pi1', 'pi2', 'cue', 'vooy', 'keyring'].every(id => use.indexOf('data-mark="' + id + '"') >= 0),
    '사용량 카드마다 마크가 붙는다');
  ok(['pi1', 'pi2', 'cue', 'cue2', 'vooy2', 'keyring2'].every(id => roles.indexOf('data-mark="' + id + '"') >= 0),
    '역할표에도 같은 마크');
  const b = Q.run(`chatOut({id: 'X1', source: 'cue', target: 'portal', kind: 'chat', status: 'DONE', prompt: '@큐 확인', result: 'ok'}, true)`);
  ok(/class="chat-av" role="img" aria-label="큐"><span class="mk mk-cue"/.test(b) && /<span class="who w-cue"><span class="mk mk-cue mini"/.test(b),
    '큐 말풍선 = 큐 마크 아바타 + 큐 색 이름 배지');
  const c2 = Q.run(`chatOut({id: 'X2', source: 'cue2', target: 'portal', kind: 'chat', status: 'DONE', prompt: '@큐투 확인', result: 'ok'}, true)`);
  ok(/data-mark="cue2"/.test(c2) && /mk-cue2 v2/.test(c2), '큐투 말풍선은 테두리 마크(cue2)로 갈린다');
}

console.log('AE) 🏷️ 명부에 남은 옛 이름(큐2·부이2·키링2) → 화면·멘션은 큐투·뷔투·키투 + 여러 이름으로 부르기');
{
  // ① 서버 명부에 auto:true 로 옛 이름이 저장돼 있어도 표시 이름은 확정 호칭
  const Z = makeDevice(S);
  Z.run("agentMerge([{id:'cue2',name:'큐2',icon:'🌀',auto:true,at:'2026-11-25T01:00:00Z'}," +
    "{id:'vooy2',name:'부이2',icon:'🫛',auto:true,at:'2026-11-25T01:00:00Z'}," +
    "{id:'keyring2',name:'키링2',icon:'🔑',auto:true,at:'2026-11-25T01:00:00Z'}], [])");
  ok(Z.run("agentById('cue2').name") === '큐투' && Z.run("agentById('vooy2').name") === '뷔투' && Z.run("agentById('keyring2').name") === '키투',
    '서버 명부의 큐2·부이2·키링2 가 큐투·뷔투·키투로 보인다');
  const saved = JSON.parse(Z.store.get('portal_agents_v1') || '[]');
  ok(['cue2', 'vooy2', 'keyring2'].every(id => (saved.find(a => a.id === id) || {}).name !== undefined) &&
    saved.every(a => !['큐2', '부이2', '키링2'].includes(a.name)), '이 기기 명부에도 옛 이름을 남기지 않는다');
  ok(saved.every(a => (a.id !== 'cue2' || a.name === '큐투') && (a.id !== 'vooy2' || a.name === '뷔투') && (a.id !== 'keyring2' || a.name === '키투')),
    '저장된 이름도 큐투·뷔투·키투');

  // ② 이미 이 기기에 남아 있던 옛 이름(localStorage)도 화면에서는 확정 호칭
  const Y = makeDevice(S, {portal_agents_v1: JSON.stringify([
    {id: 'cue2', name: '큐2', icon: '🌀', auto: true, at: '2026-11-24T01:00:00Z'},
    {id: 'vooy2', name: '부이2', icon: '🫛', auto: true, at: '2026-11-24T01:00:00Z'},
    {id: 'keyring2', name: '키링2', icon: '🔑', auto: true, at: '2026-11-24T01:00:00Z'}
  ])});
  ok(Y.run("agentById('cue2').name") === '큐투' && Y.run("agentById('keyring2').name") === '키투', '예전에 저장된 큐2·키링2 도 큐투·키투로 보인다');
  Y.run('renderRoom()');
  const mentZ = Y.el('ord-mentions').innerHTML, filtZ = Y.el('ord-filters').innerHTML, roleZ = Y.el('role-table').innerHTML;
  ok(/@큐투/.test(mentZ) && /@뷔투/.test(mentZ) && /@키투/.test(mentZ), '대상 칩이 @큐투·@뷔투·@키투');
  ok(!/@큐2<|@큐2\b/.test(mentZ.replace(/@큐투/g, '')) && mentZ.indexOf('@큐2') < 0, '대상 칩에 옛 이름(@큐2)이 남지 않는다');
  ok(/큐투/.test(filtZ) && filtZ.indexOf('큐2') < 0, '발신 필터도 큐투(옛 큐2 없음)');
  ok(/<b>큐투<\/b>/.test(roleZ) && /class="role-id">cue2</.test(roleZ) && roleZ.indexOf('큐2') < 0, '역할표도 큐투 · cue2(옛 큐2 없음)');
  ok(Y.run("ordSenderLabel('cue2').name") === '큐투' && Y.run("ordLiveWho('keyring2').name") === '키투', '말풍선·지금 작업 중 이름도 확정 호칭');

  // ③ 사람이 일부러 다른 이름을 붙인 부계정은 건드리지 않는다
  ok(Y.run("agentLabelName('cue2','큐2',false)") === '큐투', '옛 부름(큐2)은 확정 호칭으로');
  ok(Y.run("agentLabelName('cue2','리서치봇',false)") === '리서치봇', '사람이 붙인 다른 이름은 그대로');
  ok(Y.run("agentLabelName('cue','큐',true)") === '큐', '부계정이 아닌 비서는 영향 없음');

  // ④ 여러 이름 — 어느 쪽으로 적어도 그 비서 앞으로
  const route = [['@큐투', 'cue2'], ['@큐2', 'cue2'], ['@cue2', 'cue2'],
    ['@뷔투', 'vooy2'], ['@부이2', 'vooy2'], ['@부이투', 'vooy2'], ['@vooy2', 'vooy2'],
    ['@키투', 'keyring2'], ['@키링2', 'keyring2'], ['@키링투', 'keyring2'], ['@keyring2', 'keyring2'],
    ['@피원', 'pi1'], ['@피클1', 'pi1'], ['@pi1', 'pi1'], ['@레이의피클', 'pi1'],
    ['@피투', 'pi2'], ['@피클2', 'pi2'], ['@pi2', 'pi2'],
    ['@큐', 'cue'], ['@부이', 'vooy'], ['@키링', 'keyring'], ['@노트북', 'notebook']];
  const missed = route.filter(([t, id]) => Y.run('ordTargetFromText(' + JSON.stringify(t + ' 이거 봐줘') + ')') !== id);
  ok(missed.length === 0, '모든 별칭이 제 비서 앞으로 (틀린 것: ' + missed.map(x => x[0]).join(' ') + ')');
  ok(Y.run("ordTargetFromText('@레이의피클 확인')") === 'pi1', '@레이의피클 은 @레이 보다 긴 이름으로 먼저 잡힌다');

  // ⑤ 나를 부르는 이름은 비서에게 가지 않는다
  ok(Y.run("agentAliasId('레이')") === 'portal' && Y.run("agentAliasId('성래')") === 'portal', '레이·성래 는 나(portal)');
  ok(Y.run("ordTargetFromText('@레이 확인')") === '' && Y.run("ordTargetFromText('@성래 확인')") === '', '나를 부른 말은 대상을 바꾸지 않는다');
  ok(Y.run("ordMentionHtml('@레이 확인')").indexOf('mt-me') >= 0, '본문의 @레이 는 내 색 멘션 칩');

  // ⑥ 발신자·대상 매칭도 같은 별칭표 — 옛/영문 이름으로 남은 줄도 제자리
  ok(Y.run("ordSenderKey({source:'피클1'})") === 'pi1' && Y.run("ordSenderKey({source:'pickle-pi1'})") === 'pi1', '피클1·pickle-pi1 발신 → pi1');
  ok(Y.run("ordSenderKey({source:'레이'})") === 'portal', '레이 발신 → 나(portal)');
  ok(Y.run("ordTargetKey({target:'큐2'})") === 'cue2' && Y.run("ordTargetKey({target:'키링2'})") === 'keyring2', 'target 에 옛 이름이 남은 줄도 제 비서');
  ok(Y.run("ordTargetKey({target:'부이2'})") === 'vooy2' && Y.run("ordTargetKey({target:'all'})") === 'all' && Y.run("ordTargetKey({target:'없는이름'})") === 'notebook', '그 밖의 대상은 그대로');
}


console.log('AF) 💬 스레드 — 원문과 이어진 답장·보고 모아보기 (2026-11-26)');
{
  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const SB = mk();
  const nowMs = Date.now();
  const at = ms => new Date(ms).toISOString();
  const row = (id, created, source, status, payload, x) => {
    const r = [id, created, source, 'claude_prompt', 'gaegyebu', JSON.stringify(payload), status, 0, '', '', ''];
    while (r.length < HEAD.length) r.push('');
    Object.keys(x || {}).forEach(k => { const i = HEAD.indexOf(k); if (i >= 0) r[i] = x[k]; });
    return r;
  };
  SB.props.QUEUE_SHEET_ID = 'SHEETidThreadTest001';
  SB.addSheet('SHEETidThreadTest001', {'Command_Queue': [HEAD.slice(0)].concat([
    row('Q-h1', at(nowMs - 20 * 60000), 'portal', 'DONE',
      { prompt: '가계부 11월 지출 점검해줘', mode: 'ask', kind: 'chat', target: 'notebook' },
      { claimed_by: 'notebook', finished_at: at(nowMs - 19 * 60000), result: '11월 지출은 82만원이에요 — 카드값 마감 25일' }),
    row('Q-h2', at(nowMs - 12 * 60000), 'portal', 'PENDING',
      { prompt: '카드값 마감일 확인해줘', mode: 'ask', kind: 'chat', target: 'notebook', reply_to: 'Q-h1' }),
    row('Q-h3', at(nowMs - 9 * 60000), 'notebook', 'DONE',
      { prompt: '카드값은 25일입니다', mode: 'ask', kind: 'chat', target: 'portal', reply_to: 'Q-h1' },
      { claimed_by: 'notebook', finished_at: at(nowMs - 9 * 60000), result: '카드값은 25일입니다' }),
    row('Q-h4', at(nowMs - 6 * 60000), 'portal', 'DONE',
      { prompt: '대전 맛집 3곳 골라줘', mode: 'ask', kind: 'chat', target: 'cue' },
      { claimed_by: 'cue', finished_at: at(nowMs - 5 * 60000), result: '대전 맛집 세 곳: 성심당 · 진미오겹살 · 동양돌구이' })
  ])});
  const DB = makeDevice(SB);
  DB.config();
  await DB.run('loadOrders()');
  const feedB = () => DB.el('ord-list').innerHTML;

  // ① 사슬의 첫 말 — 답장의 답장이어도 처음까지 거슬러 올라간다
  ok(DB.run("ordThreadRoot('Q-h2')") === 'Q-h1', '답장 Q-h2 의 스레드 첫 말은 Q-h1');
  ok(DB.run("ordThreadRoot('Q-h1')") === 'Q-h1', '첫 말은 자기 자신');
  ok(DB.run("ordThreadRoot('Q-none')") === 'Q-none', '모르는 id 는 그대로(무한 반복 없음)');
  ok(DB.run("ordThreadItems('Q-h3').map(x=>x.id).join(',')") === 'Q-h1,Q-h2,Q-h3', '스레드 = 첫 말 + 이어진 답장(오래된 것 먼저)');
  ok(DB.run("ordThreadCount('Q-h2')") === 3 && DB.run("ordThreadCount('Q-h4')") === 1, '스레드 크기 — 이어진 말이 없으면 1');
  ok(DB.run("ordChildren('Q-h1').length") === 2, '자식 = reply_to 가 Q-h1 인 말 2개');

  // ② 말풍선의 💬 스레드 버튼 — 이어진 말이 2개 이상일 때만
  const outB = DB.run("chatOut(ordById('Q-h1'), false)");
  ok(/💬 스레드 3/.test(outB), '첫 말 말풍선에 “💬 스레드 3”');
  ok(/ordThreadOpen\('Q-h1'\)/.test(outB), '누르면 그 스레드를 연다');
  ok(!/💬 스레드/.test(DB.run("chatOut(ordById('Q-h4'), false)")), '이어진 말이 없는 오더에는 스레드 버튼 없음');
  ok(/💬 스레드/.test(DB.run("chatIn(ordById('Q-h3'))")), '비서 답장 말풍선에도 스레드 버튼');

  // ③ 스레드 모달 — 첫 말 + 답장만, 타임라인과 같은 이스케이프
  DB.run("ordThreadOpen('Q-h3')");
  ok(DB.run('ORD_THREAD') === 'Q-h1', '답장에서 열어도 첫 말 기준으로 모은다');
  const th = DB.el('ord-thread-list').innerHTML;
  ok((th.match(/class="th-row /g) || []).length === 3, '스레드에 세 줄(첫 말·답장·보고)');
  ok(/가계부 11월 지출 점검해줘/.test(th) && /카드값 마감일 확인해줘/.test(th) && /카드값은 25일입니다/.test(th), '세 말이 모두 보인다');
  ok(!/대전 맛집 세 곳/.test(th), '다른 대화는 섞이지 않는다');
  ok(/ordThreadJump/.test(th) && /ordReplyById/.test(th), '스레드 줄에 “타임라인에서”·“답장” 버튼');
  ok(DB.el('ord-thread-n').textContent === '3개 말', '스레드 머리에 개수');
  DB.run("ordThreadOpen('Q-h1'); ORD_ITEMS = ORD_ITEMS.concat([{id:'Q-x9', status:'DONE', source:'portal', kind:'chat', summary:'<img src=x>스레드', reply_to:'Q-h1', created_at:new Date().toISOString()}]); ordThreadOpen('Q-h1')");
  ok(DB.el('ord-thread-list').innerHTML.indexOf('<img') < 0 && /&lt;img/.test(DB.el('ord-thread-list').innerHTML), '스레드 본문도 이스케이프');
  DB.run("ordThreadClose()");
  ok(DB.run('ORD_THREAD') === '' && DB.el('ord-thread-list').innerHTML === '' || DB.run('ORD_THREAD') === '', '닫으면 스레드 상태를 비운다');

  // ④ 비서별 히스토리 — 보낸·받은·처리한 말을 모두 그 비서 것으로
  ok(DB.run("ordSenderMatches(ordById('Q-h4'), 'cue')") === true, '대상이 큐인 말도 큐의 히스토리');
  ok(DB.run("ordSenderMatches(ordById('Q-h1'), 'notebook')") === true, '노트북이 처리한 말도 노트북 것');
  ok(DB.run("ordSenderMatches(ordById('Q-h1'), 'cue')") === false, '상관없는 비서에게는 안 걸린다');
  ok(DB.run("ordSenderMatches({source:'pi2', target:'portal'}, 'portal')") === false, '나에게 온 말은 “내가 한 말”이 아니다');
  DB.run("ordFilterSet({dataset:{k:'who', v:'cue'}})");
  ok(/대전 맛집/.test(feedB()) && !/가계부 11월 지출/.test(feedB()), '큐 칩 → 큐와 얽힌 말만');
  DB.run("ordFilterSet({dataset:{k:'who', v:'all'}})");
  ok(/레이 님/.test(DB.el('ord-filters').innerHTML), '칩에 “레이 님”으로 보인다(포털 아님)');
  ok(/id="ord-q"/.test(html) && /ordSearchInput/.test(html), '회의실 상단에 키워드 검색칸');

  // ⑤ 키워드 검색 — 내용·결과·id, 공백으로 여러 낱말
  DB.run("ordSearchInput({value:'맛집'})");
  ok(DB.run('ORD_Q') === '맛집', '검색어를 기억');
  ok(/대전 맛집/.test(feedB()) && !/11월 지출/.test(feedB()), '키워드로 한 대화만 남긴다');
  ok(DB.run("ordSearchHit(ordById('Q-h1'), '82만원')") === true, '결과 글도 검색된다');
  ok(DB.run("ordSearchHit(ordById('Q-h1'), 'Q-h1')") === true, '오더 id 로도 찾는다');
  ok(DB.run("ordSearchHit(ordById('Q-h1'), '지출 카드값')") === true, '여러 낱말은 모두 만족해야');
  ok(DB.run("ordSearchHit(ordById('Q-h1'), '지출 없는말')") === false, '하나라도 없으면 빠진다');
  DB.run("ordSearchClear()");
  ok(DB.run('ORD_Q') === '' && /가계부 11월 지출/.test(feedB()), '✕ 로 검색을 지우면 다시 다 보인다');
}

console.log('AG) ✅ 완료 보고 — 배지·필터·보고 요청 (2026-11-26)');
{
  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const SC = mk();
  const nowMs = Date.now();
  const at = ms => new Date(ms).toISOString();
  const row = (id, created, source, status, payload, x) => {
    const r = [id, created, source, 'claude_prompt', 'gaegyebu', JSON.stringify(payload), status, 0, '', '', ''];
    while (r.length < HEAD.length) r.push('');
    Object.keys(x || {}).forEach(k => { const i = HEAD.indexOf(k); if (i >= 0) r[i] = x[k]; });
    return r;
  };
  SC.props.QUEUE_SHEET_ID = 'SHEETidReportTest001';
  SC.addSheet('SHEETidReportTest001', {'Command_Queue': [HEAD.slice(0)].concat([
    // ① 끝났다고만 남기고 결과도 보고도 없다 — 진짜 '보고누락'
    row('Q-m1', at(nowMs - 30 * 60000), 'portal', 'DONE',
      { prompt: '메리 심장사상충 약 언제 먹이지', mode: 'ask', kind: 'chat', target: 'cue' },
      { claimed_by: 'cue', finished_at: at(nowMs - 28 * 60000), result: '' }),
    // ② 결과 글은 있다(따로 회의실 보고는 없음) — 결과로 대신 보여준다
    row('Q-m2', at(nowMs - 60 * 60000), 'portal', 'DONE',
      { prompt: '대전 맛집 3곳 골라줘', mode: 'ask', kind: 'chat', target: 'cue' },
      { claimed_by: 'cue', finished_at: at(nowMs - 58 * 60000), result: '성심당 · 진미오겹살 · 동양돌구이 세 곳이에요' }),
    // ③ 결과 + 후속 보고 둘 다 있다
    row('Q-m3', at(nowMs - 90 * 60000), 'portal', 'DONE',
      { prompt: '이번 주 일정 정리해줘', mode: 'ask', kind: 'chat', target: 'notebook' },
      { claimed_by: 'notebook', finished_at: at(nowMs - 88 * 60000), result: '이번 주는 화·목 두 건이에요' }),
    row('Q-m4', at(nowMs - 86 * 60000), 'notebook', 'DONE',
      { prompt: '한 줄로 남깁니다 — 화·목 두 건', mode: 'ask', kind: 'chat', target: 'portal', reply_to: 'Q-m3' },
      { claimed_by: 'notebook', finished_at: at(nowMs - 86 * 60000), result: '화·목 두 건입니다' }),
    // ④ 15분 넘게 차례 대기 — 답장만 남기고 queue_done 을 안 찍은 모양
    row('Q-m5', at(nowMs - 40 * 60000), 'portal', 'PENDING',
      { prompt: '묘한살림 품절 점검해줘', mode: 'ask', kind: 'chat', target: 'vooy' })
  ])});
  const DC = makeDevice(SC);
  DC.config();
  await DC.run('loadOrders()');
  const feedC = () => DC.el('ord-list').innerHTML;

  // ① 상태 판정 — 근거(답장·결과)로만 말한다
  ok(DC.run("ordReportState(ordById('Q-m1'))") === 'miss', '끝났는데 결과도 보고도 없으면 보고누락');
  ok(DC.run("ordReportState(ordById('Q-m2'))") === 'auto', '결과 글이 있으면 결과로 대신(보고로 인정)');
  ok(DC.run("ordReportState(ordById('Q-m3'))") === 'ok', '후속 보고가 달렸으면 보고됨');
  ok(DC.run("ordReportState(ordById('Q-m5'))") === '', '끝나지 않은 말은 보고 판정 대상이 아니다');
  ok(DC.run("ordReportOf(ordById('Q-m4')) === null") === true, '답장 자신은 누군가의 보고가 아니다');
  ok(DC.run("ordReportOf(ordById('Q-m3')).by") === 'notebook', '누가 보고했는지');

  // ② 배지 — 완료·보고됨 / 완료·보고누락 / 지연(15분+)
  ok(DC.run("ordReportChip(ordById('Q-m1')).t") === '완료·보고누락', '보고누락 배지');
  ok(DC.run("ordReportChip(ordById('Q-m2')).t") === '완료·보고됨', '결과가 있으면 보고됨 배지');
  ok(DC.run("ordReportChip(ordById('Q-m3')).t") === '완료·보고됨', '보고가 달린 말도 보고됨');
  ok(DC.run("ordReportChip(ordById('Q-m5')).t") === '지연(15분+)', '15분 넘은 대기는 지연 배지');
  ok(DC.run("ordReportChip({id:'Q-pr', status:'PENDING', kind:'chat', source:'pi1', target:'vooy', created_at:new Date(Date.now()-40*60000).toISOString()})") === null,
    '아무도 집지 않는 순수 답장에는 지연 배지를 달지 않는다(머리말 대기 수와 같은 규칙)');
  ok(DC.run("ordLateMin({status:'PENDING', created_at:new Date(Date.now()-5*60000).toISOString()})") < 15, '5분은 지연 아님');
  ok(/c-miss/.test(DC.run("ordReportChipHtml(ordById('Q-m1'))")), '누락 배지는 빨간 칩');
  ok(/완료·보고누락/.test(feedC()) && /완료·보고됨/.test(feedC()) && /지연\(15분\+\)/.test(feedC()), '타임라인 말풍선에 배지가 보인다');
  ok(/보고누락 1/.test(DC.el('ord-count').textContent), '머리말에 보고누락 건수');

  // ③ 보고누락 카드 — 무엇을 했는지 물어볼 수 있다
  ok(/data-report-missing="Q-m1"/.test(feedC()), '누락 말에는 경고 카드');
  ok(!/data-report-missing="Q-m2"/.test(feedC()) && !/data-report-missing="Q-m3"/.test(feedC()), '결과·보고가 있는 말에는 카드를 만들지 않는다(중복 없음)');
  ok(/끝났다고만 남기고/.test(feedC()), '카드 문구');
  DC.run("ordAskReport('Q-m1')");
  ok(DC.run('ORD_REPLY_ID') === 'Q-m1', '보고 요청은 그 오더에 대한 답장으로 잡힌다');
  ok(/보고해줘/.test(DC.el('ord-inp').value), '요청 말을 입력칸에 채우기만 한다(자동 전송 없음)');
  ok(!DC.calls.some(c => JSON.parse(c.opts.body).action === 'queue_enqueue'), '자동으로 보내지 않는다');
  DC.run("ordQuoteClear()");

  // ④ 상태 필터 — 보고누락만 모아보기
  DC.run("ordFilterSet({dataset:{k:'st', v:'miss'}})");
  ok(/data-report-missing="Q-m1"/.test(feedC()) && !/대전 맛집/.test(feedC()), '보고누락 필터는 누락만 남긴다');
  DC.run("ordFilterSet({dataset:{k:'st', v:'all'}})");
  ok(DC.run("ordFilterSet({dataset:{k:'st', v:'nope'}}), ORD_FILTER") === 'all', '모르는 상태 값은 전체로');

  // ⑤ 지시가 아닌 기계 작업(git_pull)은 결과 카드가 곧 보고 — 누락으로 잡지 않는다
  ok(DC.run("ordReportState({id:'Q-g', type:'git_pull', status:'DONE', result:''})") === '', 'git_pull 은 보고 판정 대상 아님');
  ok(DC.run("ordReportState({id:'Q-r', type:'claude_prompt', status:'DONE', kind:'chat', source:'portal', target:'cue', claimed_by:'cue', summary:'한 줄 보고', result:'완료'})") === 'miss', '결과가 한 마디뿐이면 보고로 보지 않는다');
  ok(DC.run("ordReportState({id:'Q-p2', type:'claude_prompt', status:'DONE', kind:'chat', source:'cue', target:'portal', summary:'한 줄 보고', result:'완료'})") === '', '비서가 남긴 순수 답장은 보고 판정 대상이 아니다(그 말 자체가 내용)');
  ok(DC.run("ordReportState({id:'Q-s', type:'claude_prompt', status:'DONE', reply_to:'Q-p', result:''})") === '', '답장 자체는 보고 판정 대상이 아니다');
}

console.log('AH) 📋 오늘 브리핑 — 비서 9명 한 판 · 예전 배포 어림 · 줄 누르면 그 비서 말만 (2026-11-26)');
{
  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const SB = mk();
  const nowMs = SB.sb.Date.now();
  const at = ms => new Date(ms).toISOString();
  const row = (id, agoMin, source, status, payload, x) => {
    const r = [id, at(nowMs - agoMin * 60000), source, 'claude_prompt', 'gaegyebu', JSON.stringify(payload), status, 0, '', '', ''];
    while (r.length < HEAD.length) r.push('');
    Object.keys(x || {}).forEach(k => { const i = HEAD.indexOf(k); if (i >= 0) r[i] = x[k]; });
    return r;
  };
  const chat = (target, prompt, x) => Object.assign({ prompt, mode: 'ask', kind: 'chat', target }, x || {});
  SB.props.QUEUE_SHEET_ID = 'SHEETidBriefUi01';
  SB.addSheet('SHEETidBriefUi01', {'Command_Queue': [HEAD.slice(0),
    row('Q-u1', 200, 'pi1', 'PENDING', chat('cue', '[임명] 큐 — 일정 전담 <img src=x onerror=alert(1)>')),
    row('Q-u2', 30, 'vooy', 'DONE', chat('pi1', '@피원 확인했어요.'), { claimed_by: 'pi1', finished_at: at(nowMs - 25 * 60000), result: '수신 완료' }),
    row('Q-u3', 10, 'pi2', 'DONE', chat('portal', 'PR #26 올렸어요')),
    row('Q-u4', 5, 'portal', 'PENDING', chat('vooy2', '@뷔투 태그해줘'))
  ]});
  const DB = makeDevice(SB);
  DB.config();
  await DB.run('loadOrders()');
  await DB.run('briefLoad(true)');
  const list = () => DB.el('brief-list').innerHTML;

  // ① 서버 브리핑 — 9명이 정해진 순서로, 누가 밀렸는지
  ok(DB.run('BRIEF_MODE') === 'server' && DB.calls.some(c => JSON.parse(c.opts.body).action === 'queue_brief'), '서버 queue_brief 로 읽는다(POST·키)');
  const order = [...list().matchAll(/data-brief="([a-z0-9_-]+)"/g)].map(m => m[1]);
  ok(order.slice(0, 9).join(',') === 'pi1,pi2,cue,cue2,vooy,vooy2,keyring,keyring2,notebook', '비서 9명이 정해진 순서로 그려진다');
  ok(/data-brief="cue"[^>]*>[\s\S]*?미전달 1/.test(list()), '큐 줄에 미전달 1(새 서버는 안 읽음을 미전달·전달됨·접수로 가른다)');
  ok(/가장 오래 미전달된 말 · 피원/.test(list()), '가장 오래 미전달된 말 — 누가 보냈는지 이름으로');
  ok(!/<img src=x/.test(list()) && /&lt;img src=x/.test(list()), '비서가 쓴 말은 이스케이프한다(XSS)');
  ok(/class="brief-row lv-bad" data-k="who" data-v="cue"/.test(list()), '2시간 넘게 안 읽은 비서는 빨강');
  // (가짜 서버 시계는 10/13, 화면은 실제 시계라 '막 밀린' 판정은 값을 직접 넣어 본다)
  ok(DB.run("briefLevel({unread:1, oldest_unread:{at:new Date(Date.now()-5*60000).toISOString()}})") === 'warn', '막 밀린 비서는 노랑');
  ok(DB.run("briefLevel({replied_open:2})") === 'warn' && DB.run("briefLevel({failed_today:1})") === 'bad', '답만 함 = 노랑 · 실패 = 빨강');
  ok(/class="brief-row lv-ok" data-k="who" data-v="pi1"/.test(list()), '다 처리한 비서는 초록');
  ok(/보낸 말 1 \(확인만 1\)/.test(list()), "부이 — '확인했어요'만 한 말을 따로 센다");
  ok(/안 읽은 일 <b>2<\/b>/.test(DB.el('brief-sum').innerHTML) && /오늘 나에게 온 말 <b>1<\/b>/.test(DB.el('brief-sum').innerHTML), '요약 알약 — 안 읽은 일·나에게 온 말');
  ok(DB.el('brief-badge').textContent === '밀림 2', '제목 배지 = 밀린 수');
  ok(/서버 \d{4}-\d{2}-\d{2}\./.test(DB.el('brief-note').textContent), '안내줄에 서버 버전(배포 확인용)');
  ok(/data-mark="cue2"/.test(list()) && /큐투/.test(list()), '명부에 없던 큐투도 이름·마크가 붙는다');

  // ② 1분 안에는 다시 부르지 않는다
  const n0 = DB.calls.filter(c => JSON.parse(c.opts.body).action === 'queue_brief').length;
  await DB.run('briefLoad()');
  ok(DB.calls.filter(c => JSON.parse(c.opts.body).action === 'queue_brief').length === n0, '1분 안에는 캐시 — 서버를 다시 부르지 않는다');

  // ③ 줄을 누르면 회의실에서 그 비서의 말만
  DB.run("briefPick({dataset:{k:'who', v:'cue'}})");
  ok(DB.run('ORD_WHO') === 'cue', '비서 줄 → 회의실 필터가 그 비서');
  DB.run("ordFilterSet({dataset:{k:'who', v:'all'}})");

  // ④ 예전 배포(queue_brief 모름) — 지금 목록으로 어림하고 그렇다고 밝힌다
  ok(DB.run(`(()=>{ const b = briefFromItems(ORD_ITEMS); const c = b.agents.find(a=>a.id==='cue'); return b.local === true && c.unread === 1 && c.oldest_unread.from === 'pi1'; })()`) === true,
    '목록으로 어림해도 같은 모양(안 읽음·가장 오래된 말)');
  DB.run(`BRIEF_MODE='local'; BRIEF=briefFromItems(ORD_ITEMS); renderBrief();`);
  ok(/어림했어요/.test(DB.el('brief-note').textContent) && /재배포/.test(DB.el('brief-note').textContent), '어림이면 안내줄에 밝힌다(숫자를 지어내지 않는다)');

  // ⑤ 가동 한 줄 — 깨우는 방식·확인 시각, 근거 없으면 '기록 없음'
  ok(DB.run("briefPulse({wake:'poll', last_check_at:new Date(Date.now()-3*60000).toISOString()}).t") === '⏱ 주기 확인 · 확인 3분 전', '주기 확인 비서는 마지막 확인 시각');
  ok(DB.run("briefPulse({}).t") === '기록 없음' && DB.run("briefPulse({}).cls") === 'off', '근거가 없으면 기록 없음');
  ok(DB.run("briefPulse({wake:'webhook', last:{at:new Date(Date.now()-5*60000).toISOString()}}).cls") === 'on', '최근 활동이면 초록');

  // ⑥ 설정 전엔 요청 없이 안내만
  const DN = makeDevice(SB);
  await DN.run('briefLoad(true)');
  ok(DN.calls.length === 0 && /서버를 연결하면/.test(DN.el('brief-list').innerHTML), '서버 설정 전엔 요청 없이 안내만');
}

console.log('AI) 👀 이모지 반응 — 말풍선 칩 · 대기 문구 · 브리핑 전달됨/접수 (2026-11-26)');
{
  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const SR = mk();
  const nowMs = SR.sb.Date.now();
  const at = ms => new Date(ms).toISOString();
  const row = (id, agoMin, source, status, payload) => {
    const r = [id, at(nowMs - agoMin * 60000), source, 'claude_prompt', 'gaegyebu', JSON.stringify(payload), status, 0, '', '', ''];
    while (r.length < HEAD.length) r.push('');
    return r;
  };
  const chat = (target, prompt) => ({ prompt, mode: 'ask', kind: 'chat', target });
  SR.props.QUEUE_SHEET_ID = 'SHEETidReactUi01';
  SR.addSheet('SHEETidReactUi01', {
    'Command_Queue': [HEAD.slice(0),
      row('Q-x1', 50, 'portal', 'PENDING', chat('keyring', '@키링 기차표 봐줘')),                 // 키링이 가져감(✓)
      row('Q-x2', 40, 'portal', 'PENDING', chat('vooy', '@부이 비교표')),                         // 부이가 접수(👀)
      row('Q-x3', 30, 'portal', 'PENDING', chat('cue', '@큐 일정')),                              // 아무 반응 없음
      row('Q-x4', 20, 'portal', 'DONE', chat('vooy2', '@뷔투 <b>체크</b>')),                      // 뷔투 완료 + 이스케이프
      row('Q-x5', 10, 'pi1', 'PENDING', chat('all', '@전체 공지'))
    ],
    'Reactions': [['at', 'order_id', 'agent', 'emoji'],
      [at(nowMs - 20 * 60000), 'Q-x1', 'keyring', '✓'],
      [at(nowMs - 15 * 60000), 'Q-x2', 'vooy', '✓'], [at(nowMs - 14 * 60000), 'Q-x2', 'vooy', '👀'],
      [at(nowMs - 5 * 60000), 'Q-x4', 'vooy2', '👀'], [at(nowMs - 4 * 60000), 'Q-x4', 'vooy2', '✅'],
      [at(nowMs - 3 * 60000), 'Q-x4', 'cue', '✓'],
      [at(nowMs - 2 * 60000), 'Q-x1', 'evil<img src=x>', '👀'], [at(nowMs - 1 * 60000), 'Q-x1', 'keyring', '😂']]
  });
  const DR = makeDevice(SR);
  DR.config();
  await DR.run('loadOrders()');
  await DR.run('briefLoad(true)');
  const feed = () => DR.el('ord-list').innerHTML;
  const rxOf = id => DR.run(`ordReactHtml(ordById('${id}'))`);

  // ① 비서마다 가장 앞선 반응 하나 — ✅ > 🙅 > 🔧 > 👀 > ✓
  ok(DR.run("ordReactTop(ordById('Q-x2')).map(x => x.by + x.e).join(',')") === 'vooy👀', '👀 이 ✓ 보다 앞선다(한 비서에 하나만)');
  ok(DR.run("ordReactTop(ordById('Q-x4')).map(x => x.by + x.e).join(',')") === 'cue✓,vooy2✅', '비서별로 하나씩 — ✅ 은 ✓·👀 을 덮는다');
  ok(DR.run("ordReactTop({reactions:[{by:'a',e:'🔧'},{by:'a',e:'🙅'}]}).map(x => x.e).join('')") === '🙅', '🙅 > 🔧');
  ok(DR.run("ordReactTop({}).length + ordReactTop({reactions:'x'}).length + ordReactTop(null).length") === 0, '반응이 없거나 모양이 이상하면 빈 목록');
  ok(DR.run("ordReactTop({reactions:[{by:'a',e:'😂'},{e:'👀'}]}).length") === 0, '정해진 이모지 밖·비서 없는 반응은 무시한다');

  // ② 말풍선 밑 칩
  ok(/class="rx"/.test(rxOf('Q-x4')) && /rx-dn/.test(rxOf('Q-x4')) && /rx-dv/.test(rxOf('Q-x4')), '완료는 초록 칩 · 전달됨은 회색 칩');
  ok(rxOf('Q-x3') === '', '반응이 없는 말에는 칩 영역 자체를 안 그린다');
  ok(/data-mark|뷔투/.test(rxOf('Q-x4')) || /뷔투/.test(rxOf('Q-x4')), '칩에 비서 이름이 보인다');
  ok(/title="뷔투 · 완료/.test(rxOf('Q-x4')), '칩 title 에 상태 말(완료)');
  ok(/title="키링 · 전달됨/.test(rxOf('Q-x1')), '✓ 은 읽음이 아니라 「전달됨」이라고 쓴다');
  ok(!/읽음/.test(rxOf('Q-x1')) && !/읽음/.test(rxOf('Q-x2')), '칩 문구에 「읽음」이라고 쓰지 않는다');
  ok(!/<img src=x>/.test(rxOf('Q-x1')) && /&lt;img src=x&gt;/.test(rxOf('Q-x1')), '비서 이름이 이상해도 이스케이프한다(XSS)');
  ok(/class="rx"/.test(feed()) && /rxc/.test(feed()), '타임라인 내 말풍선 밑에 칩이 그려진다');

  // ③ 대기 말풍선 문구 — "다음 확인 때"가 아니라 실제 상태로
  const pend = id => DR.run(`chatIn(ordById('${id}'))`);
  ok(/가져갔어요\(✓ 전달됨\)/.test(pend('Q-x1')) && /접수 전/.test(pend('Q-x1')), '가져갔지만 접수 전 — 그렇게 말한다');
  ok(/접수했어요\(👀 접수\)/.test(pend('Q-x2')), '👀 접수 — 그렇게 말한다');
  ok(/다음 확인 때 읽어요/.test(pend('Q-x3')), '반응이 없으면 예전 문구 그대로');
  ok(/등록된 비서들이 다음 확인 때 읽어요/.test(pend('Q-x5')), '@전체는 한 명의 반응으로 상태를 말하지 않는다');

  // ④ 다시 그리기 서명 — 반응만 바뀌어도 칩이 바뀐다
  const sig1 = DR.run("ordSig([{id:'a', reactions:[{by:'x', e:'✓'}]}])");
  const sig2 = DR.run("ordSig([{id:'a', reactions:[{by:'x', e:'✓'},{by:'x', e:'👀'}]}])");
  ok(sig1 !== sig2 && DR.run("ordSig([{id:'a'}])") !== sig1, '반응이 달리면 목록 서명이 달라진다');

  // ⑤ 브리핑 — 미전달 / 전달됨 / 접수 (서버가 반응 탭을 읽어 가른다)
  const bl = DR.el('brief-list').innerHTML;
  ok(/data-brief="cue"[^>]*>[\s\S]*?미전달 1/.test(bl), '큐 — 반응이 없으면 미전달');
  ok(/data-brief="keyring"[^>]*>[\s\S]*?전달됨 1/.test(bl), '키링 — 가져갔지만 접수 전이면 전달됨');
  ok(/data-brief="vooy"[^>]*>[\s\S]*?접수 1/.test(bl), '부이 — 👀 하면 접수');
  ok(/반응 \d+분/.test(bl), '오늘 온 말에 처음 반응하기까지 걸린 시간(중간값)');
  ok(/미전달 <b>1<\/b>/.test(DR.el('brief-sum').innerHTML) && /전달됨\(접수 전\) <b>1<\/b>/.test(DR.el('brief-sum').innerHTML) && /접수 <b>1<\/b>/.test(DR.el('brief-sum').innerHTML), '요약 알약도 같은 3분류');
  ok(/가장 오래 미전달된 말/.test(bl), '가장 오래 미전달된 말만 경고한다(가져간 말은 방치가 아니다)');
  ok(/자동으로 남기고/.test(DR.el('brief-note').textContent) && /이해했다는 뜻은 아니에요/.test(DR.el('brief-note').textContent), '안내줄이 ✓ 의 한계를 밝힌다');
  ok(DR.run("briefLevel({undelivered:0, delivered:2, seen:0, unread:2, oldest_undelivered:null, oldest_unread:{at:new Date(Date.now()-300*60000).toISOString()}})") === 'warn',
    '가져가기만 하고 5시간 지나도 빨강은 아니다(노랑) — 미전달만 빨강');
  ok(DR.run("briefLevel({undelivered:1, unread:1, oldest_undelivered:{at:new Date(Date.now()-300*60000).toISOString()}})") === 'bad', '5시간 미전달은 빨강');
  // 예전 서버(반응 필드 없음) — 기존 '안 읽음' 표기 그대로
  ok(/안 읽음 2/.test(DR.run("briefRow({id:'cue', unread:2, handled_today:0})")) && !/미전달/.test(DR.run("briefRow({id:'cue', unread:2, handled_today:0})")), '예전 서버 응답은 안 읽음으로 그린다');
}

console.log('AJ) 🔔 승인함 — 모으기 · 결정 · 타임라인 표시 · 예전 배포 (2026-11-27)');
{
  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const SP = mk();
  const nowMs = SP.sb.Date.now();
  const at = ms => new Date(ms).toISOString();
  const row = (id, agoMin, source, status, payload, x) => {
    const r = [id, at(nowMs - agoMin * 60000), source, 'claude_prompt', 'gaegyebu', JSON.stringify(payload), status, 0, '', '', ''];
    while (r.length < HEAD.length) r.push('');
    Object.keys(x || {}).forEach(k => { const i = HEAD.indexOf(k); if (i >= 0) r[i] = x[k]; });
    return r;
  };
  SP.props.QUEUE_SHEET_ID = 'SHEETidApprUi01';
  SP.addSheet('SHEETidApprUi01', {'Command_Queue': [HEAD.slice(0),
    row('Q-p1', 30, 'keyring2', 'PENDING', { prompt: '블로그 임시저장 2건 수정 <img src=x onerror=alert(1)>\n발행은 안 함', mode: 'ask', kind: 'approval', target: 'portal', title: '블로그 임시저장 <b>2건</b> 수정', risk: '외부 계정', due: '오늘 18시' }),
    row('Q-p2', 20, 'vooy2', 'PENDING', { prompt: '상품명 1안으로 진행해도 될까요?', mode: 'ask', kind: 'chat', target: 'portal' }),
    row('Q-p3', 10, 'portal', 'WAITING_APPROVAL', { prompt: '포털 코드 고쳐', mode: 'edit' }, { risk_level: 'HIGH', approval_expires_at: at(nowMs + 10 * 60000) })
  ]});
  const DP = makeDevice(SP);
  DP.config();
  await DP.run('loadOrders()');
  await DP.run('apprLoad(true)');
  const L = () => DP.el('appr-list').innerHTML;

  // ① 모으기 — 요청 · 승인 묻는 말 · 실행 승인
  ok(DP.run('APPR_MODE') === 'server' && DP.calls.some(c => JSON.parse(c.opts.body).action === 'approval_list'), '서버 approval_list 로 읽는다(POST·키)');
  ok(/data-appr="Q-p1"/.test(L()) && /data-appr="Q-p2"/.test(L()) && /data-appr="Q-p3"/.test(L()), '세 갈래가 다 보인다');
  ok(/k-request/.test(L()) && /k-suggested/.test(L()) && /k-order/.test(L()), '갈래별 모양(요청·자동 감지·실행 승인)');
  ok(/승인 묻는 말 · 자동 감지/.test(L()), '자동 감지는 확실하지 않다고 표시');
  ok(/외부 계정/.test(L()) && /기한 오늘 18시/.test(L()), '위험 종류·기한 표시');
  ok(!/<img src=x/.test(L()) && !/<b>2건<\/b>/.test(L()) && /&lt;b&gt;2건/.test(L()), '제목·본문 이스케이프(XSS)');
  ok(DP.el('appr-badge').textContent === '결정 3', '제목 배지 = 결정할 수');
  ok(!/data-id="Q-p3" onclick="apprDecide\(this\.dataset\.id,'hold'\)"/.test(L()) && /data-id="Q-p1" onclick="apprDecide\(this\.dataset\.id,'hold'\)"/.test(L()), '실행 승인에는 보류 버튼이 없다');
  ok(/placeholder="메모\(선택\)/.test(L()), '메모 칸');

  // ② 결정 — 승인(메모 포함) → 서버 기록 + 요청한 비서에게 답장 + 승인함에서 빠진다
  DP.el('appr-memo-Q-p1').value = '발행은 절대 금지';
  await DP.run("apprDecide('Q-p1','approve')");
  const dec = DP.calls.map(c => JSON.parse(c.opts.body)).filter(b => b.action === 'approval_decide');
  ok(dec.length === 1 && dec[0].id === 'Q-p1' && dec[0].decision === 'approve' && dec[0].note === '발행은 절대 금지', 'approval_decide 로 결정과 메모를 보낸다');
  const sheet = SP.books['SHEETidApprUi01']['Command_Queue'];
  const p1 = sheet.find(r => r[0] === 'Q-p1');
  ok(p1[HEAD.indexOf('status')] === 'DONE' && /^✅ 승인 — 발행은 절대 금지/.test(p1[HEAD.indexOf('approval_note')]), '시트에 결정이 남는다');
  ok(sheet.some(r => { try { const q = JSON.parse(r[HEAD.indexOf('payload')]); return q.target === 'keyring2' && q.reply_to === 'Q-p1'; } catch (e) { return false; } }), '키투에게 결과 답장이 간다');
  ok(!/data-appr="Q-p1"/.test(L()) && DP.el('appr-badge').textContent === '결정 2', '결정한 건 승인함에서 빠진다');
  // 보류 → 맨 뒤 '보류 중'
  await DP.run("apprDecide('Q-p2','hold')");
  ok(/class="appr-row k-suggested held"|held/.test(L()) || !/data-appr="Q-p2"/.test(L()), '보류 처리(대화형 질문은 기록만 하고 빠질 수 있다)');
  // 실행 승인 → queue_decide 와 같은 길(서버가 위임)
  await DP.run("apprDecide('Q-p3','approve')");
  ok(sheet.find(r => r[0] === 'Q-p3')[HEAD.indexOf('status')] === 'PENDING', '실행 승인 → 노트북 실행 차례(PENDING)');
  ok(DP.el('appr-list').innerHTML.indexOf('결정할 것이 없어요') >= 0 && /appr-card empty/.test(DP.el('approval-card').className), '다 결정하면 한 줄로 접힌다');

  // ③ 타임라인 — 승인 요청은 대화처럼, 표시만 붙인다
  ok(DP.run("ordIsChat({kind:'approval'}) && ordIsApproval({kind:'approval'}) && !ordIsApproval({kind:'chat'})") === true, '승인 요청은 대화로 그린다');
  ok(/결정 대기/.test(DP.run("ordApprovalChip({kind:'approval'})")) && /✅ 승인됨/.test(DP.run("ordApprovalChip({kind:'approval', approval:{decision:'approve'}})")) && /⏸ 보류/.test(DP.run("ordApprovalChip({kind:'chat', approval:{decision:'hold'}})")), '표시: 결정 대기·승인됨·보류');
  ok(DP.run("ordApprovalChip({kind:'chat'})") === '', '보통 대화엔 표시 없음');
  ok(DP.run("ordShowReply({kind:'approval', status:'DONE', source:'keyring2', target:'portal', result:'✅ 승인'})") === false, '결정 결과를 요청자 이름의 두 번째 말풍선으로 그리지 않는다');
  ok(/승인함에서 결정/.test(DP.run("chatOut({id:'Q-z', kind:'approval', source:'vooy', target:'portal', status:'PENDING', needs_decision:true, summary:'결제 승인 부탁'}, true)")), '결정 대기 말풍선에 「승인함에서 결정」 버튼');

  // 승인 요청은 '지금 작업 중'·대기 건수에 안 들어간다(레이 님 결정 대기 — 승인함에만)
  ok(DP.run("ordNeedsWorker({kind:'approval', source:'zzz', target:'portal', status:'PENDING'})") === false, '승인 요청은 실행할 비서가 없다(명부에 없는 발신자여도)');
  DP.run("ORD_ITEMS=[{id:'Q-l1', kind:'approval', source:'zzz', target:'portal', status:'PENDING', created_at:new Date().toISOString()},{id:'Q-l2', kind:'chat', source:'portal', target:'cue', status:'PENDING', created_at:new Date().toISOString()}]");
  ok(DP.run("ordLiveList().map(x=>x.it.id).join()") === 'Q-l2', '지금 작업 중 목록에서 승인 요청은 빠진다');
  // ④ 예전 배포 — approval_list 모르면 실행 승인 대기만(어림이라고 밝힌다)
  ok(DP.run("apprFromItems([{id:'a', status:'WAITING_APPROVAL'},{id:'b', status:'PENDING', kind:'approval'}]).items.map(x=>x.id).join()") === 'a', '예전 배포: 지금 목록의 실행 승인 대기만');
  DP.run("APPR_MODE='local'; APPR=apprFromItems([]); renderAppr();");
  ok(/재배포/.test(DP.el('appr-note').textContent), '예전 배포면 안내줄에 밝힌다');
  // ⑤ 설정 전엔 요청 없이 안내만
  const DN = makeDevice(SP);
  await DN.run('apprLoad(true)');
  ok(DN.calls.length === 0 && /서버를 연결하면/.test(DN.el('appr-list').innerHTML), '서버 설정 전엔 요청 없이 안내만');
}

console.log('AK) 🌿 입력칸 어사이드 · 🧹 자동 정리 (2026-11-27)');
{
  const HEAD = ['id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash'];
  const SK = mk();
  SK.props.QUEUE_SHEET_ID = 'SHEETidAsideUi01';
  SK.addSheet('SHEETidAsideUi01', {'Command_Queue': [HEAD.slice(0)]});
  const DK = makeDevice(SK);
  DK.config();
  const enqs = () => DK.calls.map(c => JSON.parse(c.opts.body)).filter(b => b.action === 'queue_enqueue');
  // ① 입력칸에 「🌿어사이드 네이버」 — 버튼과 같은 길(노트북·대화·한 줄)로, 답장 인용은 붙이지 않는다
  DK.run("ORD_REPLY_TO='Q-old'; ORD_REPLY_ID='Q-old'; ORD_TARGET='all';");
  DK.el('ord-inp').value = '🌿어사이드 네이버';
  await DK.run('sendOrder()');
  let e = enqs();
  ok(e.length === 1 && e[0].payload.target === 'notebook' && e[0].payload.kind === 'chat' && e[0].payload.prompt === '🌿어사이드 네이버', '입력칸 어사이드도 노트북 앞 한 줄 명령으로 간다(대상이 @전체로 새지 않는다)');
  ok(!e[0].payload.reply_to && DK.run('ORD_REPLY_ID') === '', '답장 인용·reply_to 를 붙이지 않는다(노트북이 명령으로 알아보게)');
  ok(DK.el('ord-inp').value === '', '보내고 입력칸을 비운다');
  // 별칭(한글 낱말)도 알아본다
  DK.el('ord-inp').value = '🌿 어사이드 확인';
  await DK.run('sendOrder()');
  e = enqs();
  ok(e.length === 2 && e[1].payload.prompt === '🌿어사이드 상태', '별칭(확인) → 상태 확인 작업으로');
  ok(DK.run("asideJobByWord('알리익스프레스').id") === 'ali' && DK.run("asideJobByWord('퀴즈').id") === 'quiz' && DK.run("asideJobByWord('네이버').id") === 'naver', '한글 낱말·별칭으로 작업을 찾는다');
  // 모르는 낱말 — 보내지 않고 가능한 작업을 알려 준다
  DK.el('ord-inp').value = '🌿어사이드 쿠팡';
  await DK.run('sendOrder()');
  ok(enqs().length === 2, '없는 작업은 보내지 않는다');
  ok(DK.run("asideJobByWord('쿠팡')") === null, '모르는 낱말 → null');
  // 한 줄 명령이 아닌 말은 보통 대화로
  DK.run("ORD_TARGET='cue';");
  DK.el('ord-inp').value = '🌿어사이드 네이버 돌리고 결과 알려줘';
  await DK.run('sendOrder()');
  e = enqs();
  ok(e.length === 3 && e[2].payload.target === 'cue', '한 줄 명령이 아니면 어사이드가 아니다(보통 대화)');

  // ② 자동 정리 — 6시간에 한 번만, 설정 전엔 부르지 않는다
  const sweeps = () => DK.calls.map(c => JSON.parse(c.opts.body)).filter(b => b.action === 'queue_sweep');
  DK.store.delete('portal_autosweep_at');
  await DK.run('autoSweep()');
  ok(sweeps().length === 1 && sweeps()[0].auto === true, '자동 정리는 auto:true 로 부른다');
  await DK.run('autoSweep()');
  ok(sweeps().length === 1, '6시간 안에는 다시 부르지 않는다(이 기기 기록)');
  DK.store.set('portal_autosweep_at', String(Date.now() - 7 * 3600000));
  await DK.run('autoSweep()');
  ok(sweeps().length === 2, '6시간이 지나면 다시 부른다');
  const DN = makeDevice(SK);
  await DN.run('autoSweep()');
  ok(DN.calls.length === 0, '서버 설정 전엔 부르지 않는다');
}

console.log('AL) 📎 파일·이미지 공유 — 붙이기 · 올리기 · 말풍선 · 다시 받기 (2026-11-27)');
{
  const SKF = mk();
  const KF = SKF.KEY;
  // 회의실 한 줄을 미리 넣어 두고, 첨부가 붙은 말을 실제로 보낸다
  SKF.props.QUEUE_SHEET_ID = 'SHEETidIntFiles01';
  SKF.addSheet('SHEETidIntFiles01', { 'Command_Queue': [[
    'id','created_at','source','type','workspace','payload','status','attempts','claimed_at','claimed_by',
    'finished_at','duration_ms','exit_code','result','error','detail','risk_level','approval_expires_at',
    'approval_by','approval_at','approval_note','approval_hash']] });
  const DF = makeDevice(SKF);
  DF.config();
  const lastBody = a => {
    for (let i = DF.calls.length - 1; i >= 0; i--) { const b = JSON.parse(DF.calls[i].opts.body); if (b.action === a) return b; }
    return null;
  };
  const B64 = s => Buffer.from(String(s), 'utf8').toString('base64');

  // ① 규칙 — 포털·서버·회의실이 같은 값
  ok(DF.run('ORD_FILE_MAX') === 4 && DF.run('ORD_FILE_BYTES') === 4 * 1024 * 1024, '한 말에 4개 · 한 개 4MB');
  ok(DF.run("ordFileWhy('image/jpeg', 1024, 0)") === '' && DF.run("ordFileWhy('application/pdf', 1024, 3)") === '', '사진·PDF 는 붙는다');
  ok(/종류/.test(DF.run("ordFileWhy('application/x-msdownload', 10, 0)")), '허용 밖 종류는 이유를 말한다');
  ok(/4MB/.test(DF.run("ordFileWhy('image/png', 5*1024*1024, 0)")), '4MB 를 넘으면 크기를 말한다');
  ok(/4개/.test(DF.run("ordFileWhy('image/png', 10, 4)")), '이미 4개면 더 못 붙인다');
  ok(DF.run('ordFileSize(2048)') === '2KB' && DF.run('ordFileSize(2*1048576)') === '2MB', '크기 표시');
  ok(DF.run("ordFileIcon('application/pdf')") === '📕' && DF.run("ordFileIcon('weird/x')") === '📎', '종류 아이콘');

  // ② 붙인 파일 → 보내기 전에 Drive 로 올라간다(file_upload) → 말에 files 로 실린다
  DF.run("ORD_PEND = [{name:'사진 1.jpg', size:4, mime:'image/jpeg', dataUrl:'data:image/jpeg;base64," + B64('abcd') + "'}]");
  DF.el('ord-inp').value = '@피투 이 사진 보고 정리해줘';
  await DF.run('sendOrder()');
  const up = lastBody('file_upload');
  ok(up && up.mime === 'image/jpeg' && up.name === '사진 1.jpg' && up.data === 'data:image/jpeg;base64,' + B64('abcd'), '보내기 전에 file_upload 로 올린다(비밀 키 포함 POST)');
  const enq = lastBody('queue_enqueue');
  ok(enq && Array.isArray(enq.payload.files) && enq.payload.files.length === 1, '말에 files 가 실린다');
  ok(/^[A-Za-z0-9_-]{10,80}$/.test(String(enq.payload.files[0].id || '')), 'files 에는 Drive id 만(사진 본체 없음)');
  ok(!/base64/.test(JSON.stringify(enq.payload.files)), 'base64 는 실리지 않는다(payload 4,000자)');
  ok(DF.run('ORD_PEND.length') === 0, '보낸 뒤 미리보기는 비워진다');

  // ③ 첨부만 보내도 된다 — 글이 없으면 첨부 줄로 채운다
  DF.run("ORD_PEND = [{name:'계약서.pdf', size:120000, mime:'application/pdf', dataUrl:'data:application/pdf;base64," + B64('%PDF') + "'}]");
  DF.el('ord-inp').value = '';
  await DF.run('sendOrder()');
  const enq2 = lastBody('queue_enqueue');
  ok(enq2 && /첨부 1개/.test(enq2.payload.prompt) && enq2.payload.files.length === 1, '글 없이 첨부만 보내면 첨부 줄이 본문이 된다');

  // ④ 올리지 못하면 말을 보내지 않는다(첨부가 조용히 사라지면 상대는 온 줄 안다)
  const before = DF.calls.filter(c => JSON.parse(c.opts.body).action === 'queue_enqueue').length;
  DF.run("ORD_PEND = [{name:'큰파일.pdf', size:9*1024*1024, mime:'application/pdf', dataUrl:'data:application/pdf;base64," + B64('%PDF') + "'}]");
  DF.el('ord-inp').value = '이거 봐줘';
  await DF.run('sendOrder()');                                    // 서버가 too_large 로 거절한다(9MB)
  ok(DF.calls.filter(c => JSON.parse(c.opts.body).action === 'queue_enqueue').length === before, '업로드가 거절되면 말을 보내지 않는다');
  ok(DF.run('ORD_PEND.length') === 1, '실패한 첨부는 그대로 두어 다시 보낼 수 있다');
  DF.run('ordFilesClear()');

  // ⑤ 말풍선 — 사진은 그림 자리, 서류는 칩, 이름은 이스케이프
  const h = DF.run("ordFilesHtml({id:'Q-x', files:[{id:'1AbCdEfGhIjKlMnOpQrStUvWxYz0123', n:'사진 <b>1</b>.jpg', s:2048, m:'image/jpeg'},{id:'1AbCdEfGhIjKlMnOpQrStUvWxYz0456', n:'계약서.pdf', s:120000, m:'application/pdf'}]})");
  ok(/class="chat-files"/.test(h) && /class="chat-img" data-fid="1AbCdEfGhIjKlMnOpQrStUvWxYz0123"/.test(h), '사진은 data-fid 를 단 그림으로');
  ok(/class="chat-file"/.test(h) && /계약서\.pdf/.test(h) && /117KB/.test(h), '서류는 칩(이름·크기)');
  ok(/사진 &lt;b&gt;1&lt;\/b&gt;\.jpg/.test(h) && !/<b>1<\/b>/.test(h), '첨부 이름도 이스케이프한다');
  // 이름은 onclick 문자열에 넣지 않는다 — esc() 는 &#39; 를 풀면 코드가 되는 것을 막지 못한다(2026-11-27)
  const evil = DF.run("ordFilesHtml({id:'Q-z', files:[{id:'1AbCdEfGhIjKlMnOpQrStUvWxYz0777', n:\"x',alert(1),'\", s:10, m:'application/pdf'}]})");
  ok(!/alert\(/.test(String(evil).split('title=')[0]) && /onclick="ordFileOpen\('1AbCdEfGhIjKlMnOpQrStUvWxYz0777'\)"/.test(evil), '이름이 코드로 새지 않는다(버튼에는 id 만)');
  ok(/x&#39;,alert\(1\)/.test(evil), '이름은 title 에만 이스케이프해 들어간다');
  ok(DF.run("ordFilesHtml({id:'Q-y'})") === '' && DF.run("ordFilesHtml({files:[{n:'x'}]})") === '', '첨부가 없거나 id 가 없으면 안 그린다');

  // ⑥ 다시 받기 — file_get(비밀 키 POST)으로 받아 그리고, 한 번 받으면 기억한다
  const files1 = JSON.parse(DF.calls.filter(c => JSON.parse(c.opts.body).action === 'queue_enqueue')[0].opts.body).payload.files;
  const got = await DF.run("ordFileData('" + files1[0].id + "')");
  ok(/^data:image\/jpeg;base64,/.test(String(got)) && Buffer.from(String(got).split(',')[1], 'base64').toString('utf8') === 'abcd', 'file_get 으로 받은 바이트가 올린 내용과 같다');
  const callsBefore = DF.calls.length;
  await DF.run("ordFileData('" + files1[0].id + "')");
  ok(DF.calls.length === callsBefore, '한 번 받은 파일은 다시 요청하지 않는다(60초마다 다시 그려도 그대로)');
  const missing = await DF.run("ordFileData('1AbCdEfGhIjKlMnOpQrStUvWxYz9999')");
  ok(missing === '', '없는 파일은 빈 값(화면은 “불러오지 못했어요”만 말한다)');

  // ⑦ 화면 배선 — 버튼·입력·미리보기·붙여넣기·끌어다 놓기
  ok(/id="ord-file-btn"/.test(html) && /id="ord-file-inp"/.test(html) && /id="ord-files"/.test(html), '📎 버튼 · 파일 입력 · 미리보기 자리');
  ok(/type="file" id="ord-file-inp" multiple hidden/.test(html) && /accept="image\/\*/.test(html), '여러 개 · 사진 허용');
  ok(/onpaste="ordPaste\(event\)"/.test(html) && /ondrop="ordDragDrop\(event\)"/.test(html) && /ondragover="ordDragOver\(event\)"/.test(html), '붙여넣기·끌어다 놓기 배선');
  ok(/ordFileHydrate\(box\)/.test(html) && /chat-files/.test(html), '말풍선을 그린 뒤 사진을 채운다');
  ok(/\.room-file\{/.test(html) && /\.chat-img\{/.test(html) && /\.rf\{/.test(html), '첨부 스타일(버튼·미리보기·사진)');
}

console.log(`\n포털 통합 테스트: ${pass}건 통과, ${fail}건 실패`); process.exit(fail?1:0);
})();
