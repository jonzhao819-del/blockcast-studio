const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {app,BrowserWindow,ipcMain}=require('electron');
const {buildInspectExpression,buildFillExpression}=require('../lib/platform-adapters');
app.setPath('userData',fs.mkdtempSync(path.join(require('node:os').tmpdir(),'blockcast-workflow-')));
app.on('window-all-closed',()=>{});
const calls=[],platformIds=['douyin','bilibili','wechat'];
const states=Object.fromEntries(platformIds.map(id=>[id,{id,connected:true,formReady:false,hasVideo:false,readyToPublish:false,uploadStage:'idle',progress:null,fields:{},options:{}}]));
let failUpload=true,failFill=true,storedVideo=null,holdFill=null;
ipcMain.handle('fixture:call',async(_event,name,args)=>{
 calls.push({name,args});
 if(name==='listPlatforms')return {states};
 if(name==='runtimeInfo')return {version:'0.4.2',arch:'x64',browser:{current:{id:'builtin',name:'内置浏览器'},available:[{id:'builtin',name:'内置浏览器'}]}};
 if(name==='restoreMedia')return {file:storedVideo};
 if(name==='attachMedia'){
  const id=args[0].id;storedVideo={kind:'video',path:args[0].filePath,size:123,name:'fixture.mp4'};
  if(id==='wechat'&&failUpload)return {ok:false,error:'CDP Runtime.evaluate timed out'};
  states[id].uploadStage='uploading';return {ok:true,status:'submitted'};
 }
 if(name==='fillPlatform'){
  if(holdFill)await holdFill;
  return {ok:args[0].id!=='wechat'||!failFill,results:[{field:'title',ok:true},{field:'tags',ok:args[0].id!=='wechat'||!failFill,reason:'fixture missing topic'}]};
 }
 if(name==='publish')return {ok:false,canceled:true,error:'用户取消发布'};
 return {ok:true};
});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const completeUpload=id=>Object.assign(states[id],{uploadStage:'uploaded',progress:100,formReady:true,hasVideo:true,readyToPublish:true,fields:{title:{valuePresent:true},description:{}},options:{collection:{values:[{id:'1',name:'同名合集'},{id:'2',name:'同名合集'}]}}});
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,width:1366,height:768,useContentSize:true,webPreferences:{preload:path.join(__dirname,'workflow-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 const errors=[];window.webContents.on('console-message',(_event,...args)=>{const message=typeof args[0]==='object'?args[0].message:args[1];if(/Refused|Uncaught|TypeError/.test(String(message)))errors.push(message);});
 await window.loadFile(path.join(__dirname,'../renderer/index.html'));await wait(150);
 const run=expression=>window.webContents.executeJavaScript(expression);
 async function until(expression){for(let i=0;i<100;i++){if(await run(expression))return;await wait(100);}throw Error('Timed out: '+expression);}
 assert.equal(await run("document.querySelectorAll('.media-box').length"),1);
 assert.equal(await run("document.querySelectorAll('[data-override][open]').length"),0);
 assert(await run("document.querySelector('#videoSection').getBoundingClientRect().top < document.querySelector('#metadataSection').getBoundingClientRect().top"));
 assert(await run("document.querySelector('#uploadAll').getBoundingClientRect().bottom <= innerHeight"),'Upload action must be visible at 1366x768');
 await run("setMediaFile({kind:'video',path:'C:/fixture.mp4',size:123,name:'fixture.mp4'});document.querySelector('#uploadAll').click()");
 await until("!!work.douyin.task");await wait(100);
 assert.equal(calls.filter(x=>x.name==='attachMedia').length,3,'Uploading does not require a title');
 assert.equal(await run("document.querySelector('#commonTitle').disabled"),false,'Metadata remains editable while uploading');
 assert.equal(calls.filter(x=>x.name==='fillPlatform').length,0,'Uploading does not fill before explicit action');
 await run("document.querySelector('#commonTitle').value='测试标题';document.querySelector('#commonTitle').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#commonDescription').value='上传时填写的简介';document.querySelector('#commonDescription').dispatchEvent(new Event('input',{bubbles:true}))");
 completeUpload('douyin');completeUpload('bilibili');await until('!anyTask()');
 assert((await run("document.querySelector('[data-id=wechat] .state-summary').textContent")).includes('重新连接'));
 assert(!(await run("document.querySelector('[data-id=wechat] .state-summary').textContent")).includes('CDP'));
 const beforeRetry=calls.filter(x=>x.name==='attachMedia').length;failUpload=false;
 await run("document.querySelector('[data-task=wechat]').click()");await wait(100);completeUpload('wechat');await until('!anyTask()');
 assert.equal(calls.filter(x=>x.name==='attachMedia').length,beforeRetry+1,'Single-platform retry must not re-upload completed platforms');
 assert.equal(calls.filter(x=>x.name==='attachMedia').at(-1).args[0].id,'wechat');
 assert.equal(await run("new Set([...document.querySelector('[data-override=douyin] [data-field=collection]').options].map(x=>x.value)).size"),3);
 await run("document.querySelector('#fillAll').click()");await until('!anyTask()');
 assert.equal(await run('prepared.size'),2);
 assert(calls.filter(x=>x.name==='fillPlatform').every(x=>x.args[0].payload.description==='上传时填写的简介'));
 const uploads=calls.filter(x=>x.name==='attachMedia').length,filled=calls.filter(x=>x.name==='fillPlatform').length;
 failFill=false;await run("document.querySelector('[data-task=wechat]').click()");await until('!anyTask()');
 assert.equal(await run('prepared.size'),3);assert.equal(calls.filter(x=>x.name==='fillPlatform').length,filled+1);
 assert.equal(calls.filter(x=>x.name==='attachMedia').length,uploads,'Filling retries must never invoke upload');
 assert.equal(await run("document.querySelectorAll('[data-review-check]:checked').length"),0,'Automatic filling cannot confirm covers');
 await run("document.querySelector('#consent').checked=true;document.querySelector('#consent').dispatchEvent(new Event('change'))");
 assert.equal(await run("document.querySelector('#consent').checked"),false);
 await run("document.querySelectorAll('[data-review-check]').forEach(e=>{e.checked=true;e.dispatchEvent(new Event('change'))});document.querySelector('#consent').checked=true;document.querySelector('#consent').dispatchEvent(new Event('change'));document.querySelector('#publishAll').click()");
 await until('!publishing');assert.equal(calls.filter(x=>x.name==='publish').length,1,'Cancel stops publication sequence');
 // Editing during an in-flight fill must leave a visible need to resynchronize.
 await run("document.querySelector('#commonTitle').value='第二版';document.querySelector('#commonTitle').dispatchEvent(new Event('input',{bubbles:true}))");
 let releaseFill;holdFill=new Promise(resolve=>releaseFill=resolve);
 await run("document.querySelector('[data-task=douyin]').click()");await until("work.douyin.task==='fill'");
 await run("document.querySelector('#commonTitle').value='第三版';document.querySelector('#commonTitle').dispatchEvent(new Event('input',{bubbles:true}))");
 releaseFill();holdFill=null;await until('!anyTask()');assert.equal(await run("prepared.has('douyin')"),false);
 assert.equal(await run("eligibleFill('douyin')"),true);
 await window.loadFile(path.join(__dirname,'../renderer/index.html'));await wait(200);
 assert.equal(await run("document.querySelector('#commonTitle').value"),'第三版');
 assert.equal(await run("document.querySelector('#commonDescription').value"),'上传时填写的简介');
 assert.equal(await run('media.video.path'),'C:/fixture.mp4');assert.equal(await run("document.querySelector('#consent').checked"),false);
 assert.equal(await run("document.querySelectorAll('[data-review-check]:checked').length"),0);
 for(const [width,height,scale] of [[1366,768,1],[1280,820,1.25],[1280,820,1.5],[375,812,1],[812,375,1]]){
  window.setContentSize(width,height);window.webContents.setZoomFactor(scale);await wait(100);
  assert(await run('document.documentElement.scrollWidth<=innerWidth+1'),'No horizontal overflow at '+width+' / '+scale);
 }
 window.setContentSize(1366,1800);window.webContents.setZoomFactor(1);
 await run("document.querySelector('#toast').classList.remove('show')");await wait(150);
 if(process.env.BLOCKCAST_UI_ARTIFACT){fs.mkdirSync(path.dirname(process.env.BLOCKCAST_UI_ARTIFACT),{recursive:true});fs.writeFileSync(process.env.BLOCKCAST_UI_ARTIFACT,(await window.webContents.capturePage()).toPNG());}
 assert.deepEqual(errors,[],'No renderer runtime or CSP failures');window.destroy();
  const page=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const inspect=async(html)=>{await page.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));return page.webContents.executeJavaScript(buildInspectExpression('douyin'))};
  const form='<input placeholder="作品标题" value="测试"><div class="zone-container" contenteditable="true">描述</div><label class="radio-d4zkru">公开</label><video src="fixture.mp4"></video><button>发布</button>';
  assert.equal((await inspect(form+'<div>转码中</div>')).readyToPublish,false);
  assert.equal((await inspect(form+'<div>上传失败</div>')).uploadStage,'failed');
  assert.equal((await inspect(form+'<div class="progress">42.5%</div>')).progress,42.5);
  assert.equal((await inspect('<button>发布</button>')).readyToPublish,false);
  assert.equal((await inspect(form+'<div>上传完成</div>')).readyToPublish,true);
  assert.equal((await inspect(form.replace('<button>','<button aria-disabled="true">'))).readyToPublish,false);
  await inspect(form);
  const result=await page.webContents.executeJavaScript(buildFillExpression('douyin',{title:'新标题',visibility:'不存在'}));
  assert.equal(result.ok,false,'One successful field must not hide another failed field');
  page.destroy();
  console.log('workflow-integration: PASS (renderer task lock, snapshot, partial results, cancel, error recovery, 100/125/150% rendering; adapter state fixtures)');
}).then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1)});
