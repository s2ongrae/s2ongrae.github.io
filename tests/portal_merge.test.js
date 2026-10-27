const fs=require('fs'), vm=require('vm');
const ctx=vm.createContext({console}); vm.runInContext(fs.readFileSync(require('path').join(__dirname,'.build','memo_core.js'),'utf8')+'\nthis.__a={mergeMemos,normalizeMemoList,makeMemoBase,sameMemoLists,normMemo,normMemoTombs,stableStringify,itemHash};', ctx);
const A=ctx.__a; let pass=0,fail=0; const ok=(c,m)=>{ if(c)pass++; else {fail++;console.log('  ❌',m);} };
const M=(id,x={})=>Object.assign({id,title:'t'+id,body:'b'+id,color:'mc-yellow',pinned:false,updatedAt:'2026-10-0'+(id.length%9+1)+'T00:00:00Z'},x);
const clone=o=>JSON.parse(JSON.stringify(o)); const ids=r=>r.memos.map(m=>m.id).join(',');
function sc(base,el,es,tl,ts){ const L=clone(base),S=clone(base); el&&el(L); es&&es(S); return A.mergeMemos(A.makeMemoBase(base),L,S,tl||{},ts||{}); }
const base=[M('a'),M('b'),M('c')];

console.log('1) 기본 규칙');
let r=sc(base); ok(ids(r)==='a,b,c'&&r.conflicts===0,'변화 없음');
r=sc(base,L=>{L[0].title='내가수정'}); ok(r.memos.find(m=>m.id==='a').title==='내가수정','이 기기만 바꿈 → 내 값');
r=sc(base,null,S=>{S[1].body='서버수정'}); ok(r.memos.find(m=>m.id==='b').body==='서버수정','서버만 바꿈 → 서버 값');
r=sc(base,L=>{L[0].title='L'},S=>{S[1].title='S'}); ok(r.memos.find(m=>m.id==='a').title==='L'&&r.memos.find(m=>m.id==='b').title==='S'&&r.conflicts===0,'서로 다른 메모를 고치면 둘 다 남음');
r=sc(base,L=>{L[0].title='L'},S=>{S[0].title='S'}); ok(r.memos.find(m=>m.id==='a').title==='L'&&r.conflicts===1,'같은 메모를 둘 다 고침 → 이 기기 값 + 충돌 1건');
r=sc(base,L=>{L.unshift(M('n1'))},S=>{S.unshift(M('n2'))}); ok(r.memos.length===5,'양쪽에서 새로 쓴 메모 모두 유지');

console.log('2) 삭제·삭제 기록');
r=sc(base,L=>{L.splice(0,1)}); ok(ids(r)==='b,c'&&r.tombstones.a,'이 기기에서 지움 + 서버 그대로 → 삭제 유지 + 삭제 기록 생성');
r=sc(base,L=>{L.splice(0,1)},S=>{S[0].title='서버가고침'}); ok(ids(r)==='a,b,c','내가 지우고 서버가 고쳤으면 고친 쪽 살림');
r=sc(base,null,S=>{S.splice(0,1)}); ok(ids(r)==='a,b,c','서버에서 사라졌어도 삭제 기록이 없으면 유지(서버 증발 보호)');
r=sc(base,null,S=>{S.splice(0,1)},{},{a:'2026-10-01T00:00:00Z'}); ok(ids(r)==='b,c','삭제 기록이 있고 내가 안 고쳤으면 함께 삭제');
r=sc(base,L=>{L[0].title='고침'},S=>{S.splice(0,1)},{},{a:'2026-10-01T00:00:00Z'}); ok(ids(r)==='a,b,c'&&!r.tombstones.a,'삭제 기록이 있어도 내가 고쳤으면 내 값 살림 + 기록 정리');
const old=new Date(Date.now()-70*864e5).toISOString(); r=sc(base,null,null,{},{zz:old}); ok(!r.tombstones.zz,'60일 지난 삭제 기록 정리');
r=A.mergeMemos(A.makeMemoBase(base),clone(base),[],{},{}); ok(ids(r)==='a,b,c','서버가 통째로 비어도 내 메모 그대로');

console.log('3) 기준(base) 없음');
r=A.mergeMemos(null,[M('a',{title:'L'}),M('x')],[M('a',{title:'S'}),M('y')],{},{}); ok(ids(r).split(',').sort().join()==='a,x,y','양쪽 메모 모두 남음');
ok(r.memos.find(m=>m.id==='a').title==='S'&&r.conflicts===1,'내용이 다르면 서버 값 + 충돌 집계');
r=A.mergeMemos(null,[M('a'),M('b')],[M('a')],{},{b:'2026-10-01T00:00:00Z'}); ok(ids(r)==='a,b','기준이 없으면 삭제 기록이 있어도 지우지 않음');

console.log('4) 옛 메모(id 없음) 이어받기');
const legacy=[{title:'옛1',body:'x',color:'mc-pink',updatedAt:'2026-01-01T00:00:00Z'},{title:'옛2',body:'y',color:'mc-blue',pinned:true,updatedAt:'2026-01-02T00:00:00Z'},{title:'옛1',body:'x',color:'mc-pink',updatedAt:'2026-01-01T00:00:00Z'}];
const n1=A.normalizeMemoList(legacy), n2=A.normalizeMemoList(clone(legacy));
ok(n1.length===3&&n1.every(m=>m.id),'모든 옛 메모에 id 부여(내용이 같은 메모도 둘 다 유지)');
ok(new Set(n1.map(m=>m.id)).size===3,'id 중복 없음');
ok(JSON.stringify(n1.map(m=>m.id))===JSON.stringify(n2.map(m=>m.id)),'어느 기기에서든 같은 id (중복 생성 방지)');
r=A.mergeMemos(null,legacy,clone(legacy),{},{}); ok(r.memos.length===3&&r.conflicts===0,'두 기기가 같은 옛 메모를 가지면 중복 없이 그대로');

console.log('5) 서버 데이터를 믿지 않음');
const evil=[{id:'e1',title:'<script>alert(1)</script>',body:'b',color:'<img src=x onerror=1>',pinned:'yes',updatedAt:'x'.repeat(100)},'문자열',null,[1],{title:'id없음이어도 id 부여'},{id:'__proto__',title:'p'},{id:'e1',title:'중복'}];
const ne=A.normalizeMemoList(evil);
ok(ne[0].color==='mc-yellow'&&ne[0].pinned===false&&ne[0].updatedAt.length===40,'색상은 허용 목록으로, 고정은 true만, 시각은 40자로');
ok(ne.length===4 && !({}).polluted,'문자열·null·배열은 건너뜀, 프로토타입 오염 없음');
ok(new Set(ne.map(m=>m.id)).size===ne.length,'중복 id 정리');
r=A.mergeMemos(null,[],[{id:'__proto__',title:'x'},{id:'ok',title:'y'}],{},{__proto__:'x',constructor:'y',k:'2026-01-01T00:00:00Z'});
ok(!r.memos.some(m=>m.id==='__proto__') && r.memos.some(m=>m.id==='ok'),'서버 메모 중 id가 __proto__ 인 것은 걸러내고 정상 메모는 유지'); ok(!Object.prototype.hasOwnProperty.call(r.tombstones,'constructor'),'삭제 기록의 위험한 키 무시');

console.log('6) 순서·동일성');
r=A.mergeMemos(A.makeMemoBase([M('a'),M('b')]),[M('b'),M('a')],[M('a'),M('b'),M('new1',{updatedAt:'2026-10-09T00:00:00Z'}),M('new2',{updatedAt:'2026-10-08T00:00:00Z'})],{},{});
ok(ids(r)==='new1,new2,b,a','서버에서 새로 온 메모는 최신순으로 맨 위, 나머지는 이 기기 순서 유지');
ok(A.sameMemoLists([M('a'),M('b')],[M('b'),M('a')]),'순서만 다르면 같은 목록'); ok(!A.sameMemoLists([M('a')],[M('a',{title:'다름'})]),'내용이 다르면 다른 목록');

console.log(`\n포털 메모 병합 테스트: ${pass}건 통과, ${fail}건 실패`); process.exit(fail?1:0);
