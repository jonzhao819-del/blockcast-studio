const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const {uploadDecision}=require('../lib/upload-recovery');
const {validateMedia}=require('../lib/guards');

test('retry decisions protect existing, processing, replaced and uncertain videos',()=>{
  const file={path:'C:/fixture.mp4',size:123,mtimeMs:42};
  const previous={...file,targetId:'tab',token:'token',videoIdentity:'blob:a'};
  const current={hasVideo:true,uploadStage:'uploaded',uploadToken:'token',videoIdentity:'blob:a'};
  assert.equal(uploadDecision(previous,file,'tab',current),'reused');
  assert.equal(uploadDecision(previous,file,'tab',{...current,uploadStage:'processing'}),'reused');
  assert.equal(uploadDecision(previous,file,'tab',{...current,uploadToken:''}),'reused');
  assert.equal(uploadDecision(previous,file,'tab',{...current,videoIdentity:'blob:replacement'}),'confirm-existing');
  assert.equal(uploadDecision(previous,{...file,size:456},'tab',current),'confirm-existing');
  assert.equal(uploadDecision(previous,file,'new-tab',current),'confirm-existing');
  assert.equal(uploadDecision(null,file,'tab',current),'confirm-existing');
  assert.equal(uploadDecision(previous,file,'tab',{hasVideo:false,uploadStage:'idle'}),'confirm-retry');
  assert.equal(uploadDecision(null,file,'tab',{hasVideo:false,uploadStage:'idle'}),'submit');
});

// Exercise the actual main-process handlers with a fake platform transport.
// No logged-in browser, network request, upload or publish is used by these tests.
function harness(){
  const handlers=new Map(),saved=new Map(),commands=[],dialogs=[];
  const root=path.resolve(__dirname,'..');
  const localRequire=createRequire(path.join(root,'main.js'));
  const electron={app:{requestSingleInstanceLock:()=>true,on(){},whenReady:()=>({then(){}})},
    ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},
    dialog:{showMessageBox:async(_window,options)=>{dialogs.push(options);return {response:h.response};}}};
  const h={response:0,commands,dialogs,saved,failInspect:false,failDispatch:false,inspectDelay:0};
  const context=vm.createContext({require:name=>name==='electron'?electron:name==='./lib/guards'?{...localRequire(name),trustedSender:()=>true}:localRequire(name),
    __dirname:root,process:{env:{},argv:[],on(){}},URL,fetch:async()=>{throw Error('Network disabled in fixture');},setTimeout,clearTimeout,setInterval,clearInterval,console,AbortSignal});
  vm.runInContext(fs.readFileSync(path.join(root,'main.js'),'utf8'),context);
  h.current={hasVideo:false,formReady:false,uploadStage:'idle',pathname:'/creator-micro/content/upload',fields:{},options:{},fingerprint:'stable',videoIdentity:''};
  const target={id:'tab',type:'page',url:'https://creator.douyin.com/creator-micro/content/upload',webSocketDebuggerUrl:'ws://127.0.0.1:1'};
  const client={close:()=>commands.push('close'),call:async(method,params)=>{
    commands.push(method);
    if(method==='Runtime.evaluate'){
      if(params.expression==='location.href')return {result:{value:target.url}};
      if(params.expression.startsWith('window.__blockcastUploadToken=')){h.current.uploadToken=JSON.parse(params.expression.split('=').slice(1).join('='));return {};}
      if(h.inspectDelay)await new Promise(resolve=>setTimeout(resolve,h.inspectDelay));
      if(h.failInspect)throw Error('CDP Runtime.evaluate timed out');
      return {result:{value:{...h.current}}};
    }
    if(method==='DOM.getFlattenedDocument')return {nodes:[{nodeName:'INPUT',backendNodeId:1,attributes:['type','file','accept','video/mp4']}]};
    if(method==='DOM.setFileInputFiles'){
      h.current.hasVideo=true;h.current.formReady=true;h.current.videoIdentity='blob:submitted';h.current.uploadStage='uploaded';
      if(h.failDispatch)throw Error('CDP DOM.setFileInputFiles timed out');
    }
    return {};
  }};
  context.fixture={target,client,saved};
  vm.runInContext(`
    settings={get:key=>fixture.saved.get(key),set:(key,value)=>fixture.saved.set(key,value)};
    logger={info(){},error(){}};
    listTargets=async()=>[fixture.target];
    getClient=async()=>{cdpClients.set('douyin',{targetId:fixture.target.id,client:fixture.client});return fixture.client;};
    globalThis.api={approveMedia,inspectTargets,states:platformState,records:submittedVideos};
  `,context);
  h.api=context.api;h.call=(name,value)=>handlers.get(name)({},value);
  return h;
}
async function withVideo(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blockcast-recovery-'));try{const file=path.join(dir,'fixture.mp4');fs.writeFileSync(file,'fake video bytes');await fn(file);}finally{fs.rmSync(dir,{recursive:true});}}
test('actual attach handler submits once and resumes same video after failure/retry',()=>withVideo(async file=>{
  const h=harness();h.api.approveMedia(file,'video');
  const request={id:'douyin',filePath:file,kind:'video'};
  h.failDispatch=true;
  assert.equal((await h.call('media:attach',request)).ok,false);
  assert.equal(h.saved.get('selectedVideo').path,file);
  assert(h.saved.get('submittedVideos').douyin,'Persist dispatch before uncertain result');
  h.failDispatch=false;
  assert.equal((await h.call('media:attach',request)).status,'reused');
  assert.equal(h.commands.filter(x=>x==='DOM.setFileInputFiles').length,1);
  assert.equal(h.dialogs.length,0);
}));
test('actual restore handler validates saved media after restart, rejects changed and missing files',()=>withVideo(async file=>{
  const selected=validateMedia(file,'video');
  const h=harness();h.saved.set('selectedVideo',selected);
  assert.equal((await h.call('media:restore')).file.path,file);
  fs.appendFileSync(file,'changed');assert.equal((await h.call('media:restore')).file,null);
  fs.unlinkSync(file);assert.equal((await h.call('media:restore')).file,null);
}));
test('unknown existing video requires confirmation; cancel preserves it without upload',()=>withVideo(async file=>{
  const h=harness();h.api.approveMedia(file,'video');h.current.hasVideo=true;
  const request={id:'douyin',filePath:file,kind:'video'};
  assert.equal((await h.call('media:attach',request)).ok,false);
  assert.equal(h.dialogs.length,1);
  assert(!h.commands.includes('DOM.setFileInputFiles'));
  h.response=1;
  assert.equal((await h.call('media:attach',request)).status,'reused');
  assert(!h.commands.includes('DOM.setFileInputFiles'));
}));
test('reconnect works without a cached connection and never reloads platform draft',async()=>{
  const h=harness();
  h.failInspect=true;assert.equal((await h.call('platform:reload','douyin')).ok,false);
  h.failInspect=false;assert.equal((await h.call('platform:reload','douyin')).ok,true);
  assert.equal(h.api.states.get('douyin').connected,true);
  assert(!h.commands.includes('Page.reload'));
});
test('cover IPC is rejected and cannot submit a video or image',()=>withVideo(async file=>{
  const h=harness();h.api.approveMedia(file,'video');
  assert.equal((await h.call('media:attach',{id:'douyin',filePath:file,kind:'cover'})).ok,false);
  assert(!h.commands.includes('DOM.setFileInputFiles'));
  await assert.rejects(h.call('media:select','cover'),/无效素材类型/);
}));
