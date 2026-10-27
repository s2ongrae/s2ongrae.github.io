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

console.log('O) 제목·브랜드');
ok(/<title>KIM SEONGRAE · PORTAL<\/title>/.test(html)&&!/[^\x00-\x7F]/.test(html.match(/<title>(.*?)<\/title>/)[1].replace(/ · /,' ')),'제목은 ASCII + 가운뎃점만 (키릴 문자 없음)');
ok(/class="brand">KIM SEONG<span>RAE<\/span> · PORTAL/.test(html),'헤더 브랜드 KIM SEONGRAE');

console.log(`\n포털 통합 테스트: ${pass}건 통과, ${fail}건 실패`); process.exit(fail?1:0);
})();
