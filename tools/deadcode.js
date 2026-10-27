const fs=require('fs'), acorn=require('acorn');
const html=fs.readFileSync(process.argv[2],'utf8');
// 각 <script> 의 위치 → 최상위 함수 선언의 정확한 범위
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>({code:m[1], off:m.index+'<script>'.length}));
const funcs=[]; // {name,start,end}
for(const s of scripts){
  const ast=acorn.parse(s.code,{ecmaVersion:2022,sourceType:'script',allowReturnOutsideFunction:false});
  for(const n of ast.body) if(n.type==='FunctionDeclaration') funcs.push({name:n.id.name,start:s.off+n.start,end:s.off+n.end});
}
let text=html; const dead=new Set();
const blank=(t,a,b)=>t.slice(0,a)+' '.repeat(b-a)+t.slice(b);
let changed=true;
while(changed){
  changed=false;
  for(const f of funcs){
    if(dead.has(f.name)) continue;
    const own=blank(text,f.start,f.end);                 // 자기 자신(재귀 호출 포함)은 빼고
    const n=(own.match(new RegExp('\\b'+f.name+'\\b','g'))||[]).length;
    if(n===0){ dead.add(f.name); text=blank(text,f.start,f.end); changed=true; }
  }
}
console.log(JSON.stringify([...dead]));
