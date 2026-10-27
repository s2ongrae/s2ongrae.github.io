// 사용: node rmfuncs.js <html> <함수이름,...>  — 파서로 정확한 범위만 지우고, 바로 위에 붙은 설명 주석도 같이 정리
const fs=require('fs'), acorn=require('acorn');
const [,, file, names] = process.argv; const want=new Set(names.split(','));
let html=fs.readFileSync(file,'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>({code:m[1],off:m.index+'<script>'.length}));
const cuts=[];
for(const s of scripts){
  const ast=acorn.parse(s.code,{ecmaVersion:2022,sourceType:'script'});
  for(const n of ast.body) if(n.type==='FunctionDeclaration'&&want.has(n.id.name)){
    let a=s.off+n.start, b=s.off+n.end;
    // 같은 줄 끝의 주석(예: // deprecated)과 뒤따르는 줄바꿈까지
    const eol=html.indexOf('\n',b); const tail=html.slice(b,eol<0?html.length:eol); if(/^\s*(\/\/.*)?$/.test(tail)) b=eol<0?html.length:eol+1;
    // 바로 위에 붙은 // 주석 줄들
    for(;;){ const ls=html.lastIndexOf('\n',a-2); const line=html.slice(ls+1,a); if(/^\s*\/\/.*\n?$/.test(line)||/^\s*$/.test(line)&&false){ a=ls+1; } else break; }
    cuts.push([a,b,n.id.name]);
  }
}
cuts.sort((x,y)=>y[0]-x[0]);
const found=new Set(cuts.map(c=>c[2])); const missing=[...want].filter(n=>!found.has(n));
if(missing.length){ console.error('찾지 못한 함수:',missing.join(',')); process.exit(2); }
for(const [a,b] of cuts) html=html.slice(0,a)+html.slice(b);
html=html.replace(/\n{4,}/g,'\n\n\n');
fs.writeFileSync(file,html); console.log('삭제한 함수:',cuts.map(c=>c[2]).reverse().join(', '));
