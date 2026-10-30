'use strict';
const { app, BrowserWindow } = require('electron');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const assert=require('node:assert/strict');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'blockcast-site-test-')));
app.commandLine.appendSwitch('force-prefers-reduced-motion','reduce');
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1440,height:1000,useContentSize:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,partition:'website-test'}});
  const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message);});
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>{errors.push('Unexpected network request');callback({cancel:true});});
  await win.loadFile(path.join(__dirname,'../.site/index.html'));
  const run=code=>win.webContents.executeJavaScript(code,true);
  for(const [width,height,zoom] of [[1440,1000,1],[1024,768,1],[768,1024,1],[375,812,1],[812,375,1],[1440,1000,2]]){
    win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const report=await run('({width:innerWidth,scroll:document.documentElement.scrollWidth,headers:document.querySelectorAll("h1").length,forms:document.forms.length,email:document.querySelector("footer a[href^=mailto]").textContent,reduced:matchMedia("(prefers-reduced-motion: reduce)").matches})');
    assert(report.scroll<=report.width+1,JSON.stringify({width,height,zoom,report}));assert.equal(report.headers,1);assert.equal(report.forms,0);assert.equal(report.email,'1994763499@qq.com');assert.equal(report.reduced,true);
    console.log(JSON.stringify({viewport:[width,height],zoom,overflow:false}));
    if(process.env.BLOCKCAST_SITE_ARTIFACT_DIR && zoom===1 && [1440,375].includes(width)){
      fs.mkdirSync(process.env.BLOCKCAST_SITE_ARTIFACT_DIR,{recursive:true});
      fs.writeFileSync(path.join(process.env.BLOCKCAST_SITE_ARTIFACT_DIR,'website-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
    }
  }
  win.setContentSize(1440,1000);win.webContents.setZoomFactor(1);
  await run('document.querySelector(".skip-link").focus()');
  assert.equal(await run('document.activeElement.className'),'skip-link');
  await run('document.querySelector("#checksum").closest("details").open=true; Object.defineProperty(navigator,"clipboard",{configurable:true,value:undefined}); document.querySelector("#copy-checksum").click()');
  assert((await run('document.querySelector("#copy-status").textContent')).includes('手动复制'));
  assert.equal(await run('getSelection().toString().length'),64);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('website-render-check: PASS (6 viewport/zoom cases, no network, reduced motion, focus, copy fallback)');win.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
