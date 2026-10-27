const fs = require('fs'), vm = require('vm'), nodeCrypto = require('crypto');
module.exports = function makePortalServer(){
  let CLOCK = new Date('2026-10-13T03:00:00Z').getTime();
  class FakeFile{ constructor(n,c,p){this.name=n;this.content=c;this.parent=p;this.trashed=false;this.created=CLOCK;}
    getBlob(){const c=this.content;return{getDataAsString:()=>c};} setContent(c){this.content=c;return this;}
    getDateCreated(){return new Date(this.created);} setTrashed(t){this.trashed=t;return this;}
    makeCopy(n,f){const x=new FakeFile(n,this.content,f);f.files.push(x);return x;} }
  class FakeFolder{ constructor(n,p){this.name=n;this.parent=p;this.files=[];this.folders=[];}
    _it(a){let i=0;return{hasNext:()=>i<a.length,next:()=>a[i++]};}
    getFilesByName(n){return this._it(this.files.filter(f=>!f.trashed&&f.name===n));} getFiles(){return this._it(this.files.filter(f=>!f.trashed));}
    getFoldersByName(n){return this._it(this.folders.filter(f=>f.name===n));}
    createFolder(n){const f=new FakeFolder(n,this);this.folders.push(f);return f;}
    createFile(n,c){const f=new FakeFile(n,c,this);this.files.push(f);return f;} }
  const ROOT=new FakeFolder('',null), props={}; let lockBusy=false;
  // 캘린더
  let evSeq=0; const events=[];
  const mkEv=(title,start,end,allDay)=>{ const e={id:'ev'+(++evSeq),title,start,end,allDay,desc:''};
    return Object.assign(e,{ getId:()=>e.id,getTitle:()=>e.title,isAllDayEvent:()=>e.allDay,getStartTime:()=>e.start,getEndTime:()=>e.end,getColor:()=>'',getDescription:()=>e.desc,
      setDescription:d=>{e.desc=d;},deleteEvent:()=>{const i=events.indexOf(e);if(i>=0)events.splice(i,1);} }); };
  const calendar={ getEvents:(s,e)=>events.filter(ev=>ev.start<e&&ev.end>s),
    createAllDayEvent:(t,d)=>{const e=mkEv(t,d,new Date(d.getTime()+86400000),true);events.push(e);return e;},
    createEvent:(t,s,e)=>{const x=mkEv(t,s,e,false);events.push(x);return x;},
    getEventById:id=>events.find(e=>e.id===id)||null };
  // Tasks
  let tSeq=0; const taskStore={ '@default':[], 'list2':[] };
  const Tasks={ Tasklists:{list:()=>({items:[{id:'@default',title:'내 Tasks'},{id:'list2',title:'두번째'}]})},
    Tasks:{ list:(id)=>({items:(taskStore[id]||[]).map(t=>Object.assign({},t))}),
      insert:(t,id)=>{const x=Object.assign({id:'t'+(++tSeq),status:'needsAction'},t);(taskStore[id]=taskStore[id]||[]).push(x);return x;},
      get:(id,tid)=>Object.assign({},(taskStore[id]||[]).find(t=>t.id===tid)),
      update:(t,id,tid)=>{const a=taskStore[id]||[];const i=a.findIndex(x=>x.id===tid);if(i>=0)a[i]=t;},
      remove:(id,tid)=>{taskStore[id]=(taskStore[id]||[]).filter(t=>t.id!==tid);} } };
  const sb={ console, Logger:{log(){}}, Session:{getScriptTimeZone:()=>'Asia/Seoul'}, CalendarApp:{getDefaultCalendar:()=>calendar}, Tasks,
    DriveApp:{getFoldersByName:n=>ROOT._it(ROOT.folders.filter(f=>f.name===n)),createFolder:n=>ROOT.createFolder(n)},
    MimeType:{PLAIN_TEXT:'t'}, PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]===undefined?null:props[k],setProperty:(k,v)=>{props[k]=v;}})},
    LockService:{getScriptLock:()=>({tryLock:()=>!lockBusy,releaseLock(){}})},
    Utilities:{ sleep(){ sb.__sleeps++; }, getUuid:()=>nodeCrypto.randomUUID(),
      formatDate:(d,tz,f)=>{const x=new Date(d.getTime()+9*3600e3),p=n=>String(n).padStart(2,'0');
        return f.replace('yyyy',x.getUTCFullYear()).replace('MM',p(x.getUTCMonth()+1)).replace('dd',p(x.getUTCDate()))
          .replace('HHmmss',p(x.getUTCHours())+p(x.getUTCMinutes())+p(x.getUTCSeconds())).replace('HH',p(x.getUTCHours())).replace('mm',p(x.getUTCMinutes()));} },
    ContentService:{MimeType:{JSON:'j'},createTextOutput:t=>({_t:t,setMimeType(){return this;},getContent(){return this._t;}})},
    __sleeps:0, Date:class extends Date{constructor(...a){if(a.length)super(...a);else super(CLOCK);} static now(){return CLOCK;}} };
  vm.createContext(sb); vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','.build','portal_gs.js'),'utf8'), sb);
  const KEY='P'.repeat(20)+'q'.repeat(44); props.SECRET_KEY=KEY;
  const post = body => JSON.parse(sb.doPost({postData:{contents: typeof body==='string'?body:JSON.stringify(body)}}).getContent());
  const memoFile = ()=>{ const r=ROOT.folders.find(f=>f.name==='김성래포털'); return r&&r.files.find(f=>f.name==='포털_메모.json'); };
  return { post, KEY, ROOT, props, sb, events, taskStore, memoFile, tick:ms=>{CLOCK+=ms;}, setLock:b=>{lockBusy=b;}, doGet:()=>JSON.parse(sb.doGet({}).getContent()), run:c=>vm.runInContext(c,sb) };
};
