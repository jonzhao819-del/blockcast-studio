const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain } = require('electron');
const { buildInspectExpression, buildFillExpression } = require('../lib/platform-adapters');
app.on('window-all-closed', () => {});
const calls = [];
const states = Object.fromEntries(['douyin','bilibili','wechat'].map(id => [id,{ id,connected:true,formReady:true,hasVideo:true,readyToPublish:true,uploadStage:'uploaded',progress:42.5,fields:{title:{valuePresent:true},description:{}},options:{collection:{values:[{id:'1',name:'同名合集'},{id:'2',name:'同名合集'}]}} }]));
let rejectProbe = false;
ipcMain.handle('fixture:call', (_event, name, args) => {
  calls.push({name,args});
  if(name==='listPlatforms')return{states};
  if(name==='runtimeInfo')return{version:'fixture',arch:'x64',edgeFound:true};
  if(name==='probeOptions'&&rejectProbe)throw new Error('fixture probe failure');
  if(name==='fillPlatform')return{ok:args[0].id!=='wechat',results:[{field:'title',ok:true},{field:'tags',ok:args[0].id!=='wechat',reason:'fixture missing topic'}]};
  if(name==='publish')return{ok:false,canceled:true,error:'用户取消发布'};
  return{ok:true};
});
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,width:1280,height:820,webPreferences:{preload:path.join(__dirname,'workflow-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const errors=[];
  window.webContents.on('console-message',(_event,...args)=>{const message=typeof args[0]==='object'?args[0].message:args[1];if(/Refused|Uncaught|TypeError/.test(String(message)))errors.push(message)});
  await window.loadFile(path.join(__dirname,'../renderer/index.html'));
  await wait(250);
  const run=expression=>window.webContents.executeJavaScript(expression);
  assert.equal(await run("document.querySelectorAll('.platform-card').length"),3);
  assert.equal(await run("document.querySelector('.track i').style.width"),'42.5%');
  assert.equal(await run("new Set([...document.querySelector('[data-override=douyin] [data-field=collection]').options].map(x=>x.value)).size"),3);
  await run("document.querySelector('#commonTitle').value='测试标题'; setMediaFile({kind:'video',path:'C:/fixture.mp4',size:123,name:'fixture.mp4'});document.querySelector('#prepareAll').click()");
  assert.equal(await run("document.querySelector('#commonTitle').disabled"),true);
  for(let i=0;i<100;i++){if(await run('!busy'))break;await wait(100)}
  assert.equal(await run('busy'),false);
  assert.equal(await run('prepared.size'),2);
  assert.equal(calls.filter(x=>x.name==='attachMedia').length,3);
  assert(calls.filter(x=>x.name==='fillPlatform').every(x=>x.args[0].payload.title==='测试标题'));
  assert((await run("document.querySelector('#mediaHint').textContent")).includes('2/3'));
  assert.equal(await run("document.querySelector('#publishAll').disabled"),true);
  await run("document.querySelector('#consent').checked=true;document.querySelector('#consent').dispatchEvent(new Event('change'));document.querySelector('#publishAll').click()");
  await wait(100);
  assert.equal(calls.filter(x=>x.name==='publish').length,1,'Cancel on the first platform must stop the sequence');
  assert.equal(await run("document.querySelector('#consent').checked"),false);
  rejectProbe=true;
  await run("document.querySelector('[data-probe=douyin]').click()");await wait(100);
  assert.equal(await run("document.querySelector('[data-probe=douyin]').disabled"),false,'Failed probe must release its button');
  for(const scale of [1,1.25,1.5]){
    window.webContents.setZoomFactor(scale);await wait(100);
    assert(await run("document.querySelector('#prepareAll').getBoundingClientRect().width>0"));
  }
  window.webContents.setZoomFactor(1);
  if(process.env.BLOCKCAST_UI_ARTIFACT){fs.mkdirSync(path.dirname(process.env.BLOCKCAST_UI_ARTIFACT),{recursive:true});fs.writeFileSync(process.env.BLOCKCAST_UI_ARTIFACT,(await window.webContents.capturePage()).toPNG())}
  assert.deepEqual(errors,[],'No renderer runtime or CSP failures');
  window.destroy();
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
