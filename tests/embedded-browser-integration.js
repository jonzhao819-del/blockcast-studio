const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createEmbeddedBrowser}=require('../lib/embedded-browser');
const {buildInspectExpression}=require('../lib/platform-adapters');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'blockcast-builtin-'));
app.setPath('userData',path.join(root,'controller'));
app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 const profile=path.join(root,'platforms'),platformSession=session.fromPath(profile);
 const html='<input type="file" accept="video/mp4"><input placeholder="作品标题" value="本地测试"><div contenteditable="true" class="zone-container">简介</div><video src="https://fixture.invalid/video.mp4"></video><button>发布</button>';
 // Intercept HTTPS inside this isolated fixture session; no platform is contacted.
 platformSession.protocol.handle('https',()=>new Response(html,{headers:{'content-type':'text/html;charset=utf-8'}}));
 const browser=createEmbeddedBrowser({BrowserWindow,session,profilePath:profile,platformForUrl:url=>url.includes('creator.douyin.com')?'douyin':undefined});
 browser.open(['https://creator.douyin.com/creator-micro/content/upload']);
 browser.open(['https://creator.douyin.com/creator-micro/content/upload']);
 assert.equal(browser.targets().length,1,'Repeated open during initial loading cannot create duplicate platform windows');
 let target;
 for(let i=0;i<50;i++){target=browser.targets().find(t=>t.url.includes('creator.douyin.com'));if(target)break;await wait(100);}
 assert(target,'A platform target must be discoverable with no external browser');
 const client=browser.client(target,()=>{},()=>{});await client.ready;
 for(const method of ['Network.enable','Page.enable','DOM.enable','Runtime.enable'])await client.call(method);
 let result;
 for(let i=0;i<50;i++){result=await client.call('Runtime.evaluate',{expression:buildInspectExpression('douyin'),returnByValue:true});if(result.result?.value?.formReady)break;await wait(100);}
 assert.equal(result.result.value.formReady,true);
 const safety=await client.call('Runtime.evaluate',{expression:'({node:typeof require,ipc:typeof window.blockcast})',returnByValue:true});
 assert.deepEqual(safety.result.value,{node:'undefined',ipc:'undefined'});
 const {root:doc}=await client.call('DOM.getDocument');
 const {nodeId}=await client.call('DOM.querySelector',{nodeId:doc.nodeId,selector:'input[type=file]'});
 const video=path.join(root,'fixture.mp4');fs.writeFileSync(video,'local fixture');
 await client.call('DOM.setFileInputFiles',{nodeId,files:[video]});
 const selected=await client.call('Runtime.evaluate',{expression:'document.querySelector("input[type=file]").files[0].name',returnByValue:true});
 assert.equal(selected.result.value,'fixture.mp4');
 await client.call('Runtime.evaluate',{expression:'window.dropCount=0;document.addEventListener("dragover",e=>e.preventDefault());document.addEventListener("drop",e=>{e.preventDefault();window.dropCount=e.dataTransfer.files.length})'});
 const dragData={items:[],files:[video],dragOperationsMask:1};
 for(const type of ['dragEnter','dragOver','drop'])await client.call('Input.dispatchDragEvent',{type,x:200,y:200,data:dragData});
 const dropped=await client.call('Runtime.evaluate',{expression:'window.dropCount',returnByValue:true});assert.equal(dropped.result.value,1,'Bilibili-style CDP file drag/drop is supported');
 await platformSession.cookies.set({url:'https://creator.douyin.com',name:'fixture-cookie',value:'local-only',expirationDate:Date.now()/1000+3600});
 assert.equal((await session.defaultSession.cookies.get({name:'fixture-cookie'})).length,0,'Controller and platforms must not share cookies');
 client.close();await browser.closeAll();assert.equal(browser.targets().length,0);
 assert.equal((await session.fromPath(profile).cookies.get({name:'fixture-cookie'})).length,1,'Closing platform windows preserves login storage');
 await browser.clearData();assert.equal((await platformSession.cookies.get({name:'fixture-cookie'})).length,0);
 console.log('embedded-browser-integration: PASS (isolated Chromium, real CDP inspection/file selection, no Node or controller IPC, persistent isolated session, clear login data)');
}).then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1);});
